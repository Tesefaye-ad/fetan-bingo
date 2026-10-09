"use strict";
// npm: node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const axios = require("axios");
const mongoose = require("mongoose");

process.env.DEPOSIT_TELEBIRR_PHONE = "0920790583";
process.env.DEPOSIT_TELEBIRR_NAME = "Fetan Bingo";
process.env.MIN_DEPOSIT = "20";

// ───────────── Fake DB (ያለ MongoDB ለመሞከር) ─────────────
const get = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function matches(doc, f) {
  return Object.entries(f).every(([k, v]) => {
    if (k === "$or") return v.some((sub) => matches(doc, sub));
    const val = get(doc, k);
    if (v && typeof v === "object" && !(v instanceof Date) && "$gte" in v) return val >= v.$gte;
    return String(val) === String(v);
  });
}
const thenable = (value) => {
  const q = { select: () => q, lean: () => q, then: (a, b) => Promise.resolve(value).then(a, b) };
  return q;
};
let seq = 0;
const db = { users: [], txs: [] };
const FakeUser = {
  findById: async (id) => db.users.find((u) => String(u._id) === String(id)) || null,
  findOneAndUpdate: async (f, upd) => {
    const u = db.users.find((x) => matches(x, f));
    if (!u) return null;
    for (const [k, n] of Object.entries(upd.$inc || {})) u[k] = (u[k] || 0) + n;
    return u;
  },
};
FakeUser.Notification = { create: async () => ({}) };
const FakeTx = {
  countDocuments: async (f) => db.txs.filter((t) => matches(t, f)).length,
  findOne: (f) => thenable(db.txs.find((t) => matches(t, f)) || null),
  create: async (docs) => {
    const arr = Array.isArray(docs) ? docs : [docs];
    const out = arr.map((d) => {
      const id = d.meta && d.meta.transactionId;
      if (id && db.txs.some((t) => t.meta && t.meta.transactionId === id)) {
        throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      }
      const t = { _id: `tx${++seq}`, createdAt: new Date(), ...d };
      db.txs.push(t);
      return t;
    });
    return Array.isArray(docs) ? out : out[0];
  },
  findOneAndUpdate: async (f, upd) => {
    const t = db.txs.find((x) => matches(x, f));
    if (!t) return null;
    const { meta, ...rest } = upd.$set;
    Object.assign(t, rest);
    if (meta) t.meta = meta;
    return t;
  },
  updateOne: async (f, upd) => {
    const t = db.txs.find((x) => matches(x, f));
    if (t) Object.assign(t, upd.$set);
    return {};
  },
};
// ⚠️ እውነተኛው bot.js እንዳይጫን (እውነተኛ Telegram መልዕክት እንዳይልክ) በሐሰተኛ እንተካዋለን
const sentMessages = [];
const FakeBot = { bot: { telegram: { sendMessage: async (id, text) => { sentMessages.push({ id, text }); } } } };
for (const [rel, exp] of [["../models/User", FakeUser], ["../models/Transaction", FakeTx], ["../bot", FakeBot]]) {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exp };
}
mongoose.startSession = async () => ({ withTransaction: (fn) => fn(), endSession: async () => {} });
const { verifyAndCreditDeposit } = require("../services/telebirr/depositVerifier");
const { parseTelebirrSms } = require("../services/telebirr/smsParser");
const { verifyReceipt, nameMatches, phoneMatches } = require("../services/telebirr/receiptVerifier");

// ───────────── Fixtures ─────────────
const NOW = new Date("2026-10-08T05:40:00Z").getTime(); // 08:40 EAT
const realNow = Date.now;
test.before(() => { Date.now = () => NOW; });
test.after(() => { Date.now = realNow; });

const sms = (o = {}) =>
  `Dear Abebe, You have transferred ETB ${o.amount || "100.00"} to Fetan Bingo - 2519****0583 on ` +
  `${o.date || "08/10/2026 08:31:50"}. Your transaction number is ${o.id || "DJ85JP3L6V"}. ` +
  `The service fee is ETB 0.00 and 15% VAT ETB 0.00 on the service fee. Your current E-Money Account ` +
  `balance is ETB 250.50. https://transactioninfo.ethiotelecom.et/receipt/${o.id || "DJ85JP3L6V"} Thank you`;

const receiptHtml = (o = {}) => {
  const rows = [
    ["Payer Name", "Abebe K***"], ["Payer telebirr no.", "2519****1234"],
    ["Credited Party name", o.name || "Fetan Bingo"],
    ["Credited party account no", o.to || "2519****0583"],
    ["Transaction status", o.status || "Completed"],
    ["Invoice No.", o.id || "DJ85JP3L6V"],
    ["Payment date", o.date || "08-10-2026 08:31:50"],
    ["Settled Amount", `${o.amount || "100.00"} Birr`],
    ["Service fee", "0.00 Birr"], ["Total Paid Amount", `${o.amount || "100.00"} Birr`],
  ];
  return `<html><body><!-- ${"x".repeat(600)} --><table>${rows
    .map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table></body></html>`;
};
const mockAxios = (impl) => { axios.get = impl; };
const okReceipt = (o) => mockAxios(async () => ({ status: 200, data: receiptHtml(o) }));

function freshUser(extra = {}) {
  const u = { _id: `u${++seq}`, telegramId: "1", balance: 0, totalDeposits: 0, isBanned: false, ...extra };
  db.users.push(u);
  return u;
}

// ═══════════ 1) SMS PARSER ═══════════
test("parser: ID, amount, timestamp, URL ይወጣሉ (fee/balance አይያዙም)", () => {
  const p = parseTelebirrSms(sms());
  assert.equal(p.ok, true);
  assert.equal(p.txnId, "DJ85JP3L6V");
  assert.equal(p.amount, 100);
  assert.equal(p.timestamp.raw, "08/10/2026 08:31:50");
  assert.equal(p.timestamp.iso, "2026-10-08T08:31:50+03:00");
  assert.equal(p.receiptUrl, "https://transactioninfo.ethiotelecom.et/receipt/DJ85JP3L6V");
  assert.equal(p.direction, "sent");
});
test("parser: ኮማ ያለው መጠን እና Markdown ሊንክ", () => {
  const p = parseTelebirrSms(
    "You have transferred ETB 1,250.50 to X on 08/10/2026 08:31:50. Your transaction number is DJ85JP3L6V. " +
      "[https://transactioninfo.ethiotelecom.et/receipt/DJ85JP3L6V](https://transactioninfo.ethiotelecom.et/receipt/DJ85JP3L6V)"
  );
  assert.equal(p.amount, 1250.5);
  assert.equal(p.receiptUrl, "https://transactioninfo.ethiotelecom.et/receipt/DJ85JP3L6V");
});
test("parser: ሃሰተኛ ሊንክ / የተለያየ ID / ልክ ያልሆነ ቀን", () => {
  assert.ok(parseTelebirrSms(sms().replace("transactioninfo.ethiotelecom.et", "transactioninfo.ethiotelecom.et.evil.com")).errors.includes("fake_receipt_link"));
  assert.ok(parseTelebirrSms(sms().replace(/receipt\/DJ85JP3L6V/, "receipt/ZZ99YY8X7W")).errors.includes("txn_id_conflict"));
  assert.equal(parseTelebirrSms(sms({ date: "31/02/2026 08:31:50" })).timestamp, null);
});

// ═══════════ 2) RECEIPT VERIFIER ═══════════
const base = { txnId: "DJ85JP3L6V", expectedAmount: 100, merchant: { phone: "0920790583", name: "Fetan Bingo" }, now: NOW };
test("receipt: ትክክለኛ ደረሰኝ ያልፋል", async () => {
  okReceipt();
  const r = await verifyReceipt({ ...base, smsTimestampMs: parseTelebirrSms(sms()).timestamp.ms });
  assert.equal(r.ok, true);
  assert.equal(r.data.amount, 100);
});
test("receipt: የተለያዩ ውድቅ ምክንያቶች", async () => {
  const cases = [
    [{ amount: "90.00" }, "amount_mismatch"],
    [{ to: "2519****9999" }, "wrong_recipient"],
    [{ name: "Someone Else" }, "wrong_recipient_name"],
    [{ status: "Failed" }, "not_completed"],
    [{ id: "AA11BB22CC" }, "invoice_mismatch"],
    [{ date: "01-10-2026 08:31:50" }, "stale"],
    [{ date: "09-10-2026 08:31:50" }, "future_dated"],
  ];
  for (const [o, reason] of cases) {
    okReceipt(o);
    const r = await verifyReceipt(base);
    assert.equal(r.reason, reason, reason);
  }
});
test("receipt: 404 → ሃሰተኛ፤ ኔትወርክ ስህተት → በእጅ ማረጋገጫ", async () => {
  mockAxios(async () => ({ status: 404, data: "" }));
  assert.equal((await verifyReceipt(base)).reason, "receipt_not_found");
  mockAxios(async () => { throw new Error("ETIMEDOUT"); });
  const r = await verifyReceipt(base);
  assert.equal(r.reason, "fetch_failed");
  assert.equal(r.manualReview, true);
});
test("phone/name matchers", () => {
  assert.ok(phoneMatches("2519****0583", "0920790583"));
  // masked ቁጥር የሚያሳየው መጀመሪያ እና መጨረሻ ብቻ ነው → ተመሳሳይ ጫፍ ያለው ሌላ ቁጥር ያልፋል።
  // ለዚህ ነው DEPOSIT_TELEBIRR_NAME (የስም ማረጋገጫ) እንዲዘጋጅ የሚመከረው።
  assert.ok(phoneMatches("2519****0583", "0911110583"));
  assert.ok(!phoneMatches("2519****0584", "0920790583"));
  assert.ok(nameMatches("Fe*** Bingo", "Fetan Bingo"));
  assert.ok(!nameMatches("Abebe Kebede", "Fetan Bingo"));
});

// ═══════════ 3) WORKFLOW ═══════════
test("workflow: ✅ ስኬት — ዋሌት ይጨምራል፣ Transaction ይመዘገባል", async () => {
  okReceipt();
  const u = freshUser();
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms() });
  assert.equal(r.status, "approved");
  assert.equal(r.balance, 100);
  assert.equal(u.balance, 100);
  const tx = db.txs.find((t) => t.meta.transactionId === "DJ85JP3L6V");
  assert.equal(tx.status, "completed");
  assert.equal(tx.balanceAfter, 100);
});
test("workflow: ❌ ድግግሞሽ — በሌላ ተጠቃሚም ሆነ በራሱ", async () => {
  okReceipt();
  const other = freshUser();
  const r = await verifyAndCreditDeposit({ userId: other._id, smsText: sms() }); // ከላይ ቀድሞ ተጠቅሟል
  assert.equal(r.reason, "duplicate");
  assert.equal(other.balance, 0);
});
test("workflow: ❌ በአንድ ጊዜ ሁለት ጥያቄ (race) — አንዱ ብቻ ያልፋል", async () => {
  okReceipt({ id: "RC11RC22RC" });
  const u = freshUser();
  const s = sms({ id: "RC11RC22RC" });
  const [a, b] = await Promise.all([
    verifyAndCreditDeposit({ userId: u._id, smsText: s }),
    verifyAndCreditDeposit({ userId: u._id, smsText: s }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), ["approved", "rejected"]);
  assert.equal(u.balance, 100);
});
test("workflow: ❌ ከተጠየቀው መጠን ጋር አለመመሳሰል (reference)", async () => {
  okReceipt({ id: "AM11AM22AM" });
  const u = freshUser();
  const [req] = await FakeTx.create([{ user: u._id, type: "deposit", amount: 500, balanceAfter: 0, reference: "DEP-1", status: "pending", meta: {} }]);
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "AM11AM22AM" }), reference: "DEP-1" });
  assert.equal(r.reason, "amount_mismatch");
  assert.equal(u.balance, 0);
  assert.equal(req.status, "pending");
});
test("workflow: ✅ reference ያለው ጥያቄ ወደ completed ይቀየራል", async () => {
  okReceipt({ id: "RF11RF22RF" });
  const u = freshUser();
  await FakeTx.create([{ user: u._id, type: "deposit", amount: 100, balanceAfter: 0, reference: "DEP-2", status: "pending", meta: { gateway: "telebirr" } }]);
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "RF11RF22RF" }), reference: "DEP-2" });
  assert.equal(r.status, "approved");
  assert.equal(db.txs.find((t) => t.reference === "DEP-2").status, "completed");
  assert.equal(u.balance, 100);
});
test("workflow: ❌ ሃሰተኛ ደረሰኝ (404) እና የተሳሳተ ተቀባይ", async () => {
  const u = freshUser();
  mockAxios(async () => ({ status: 404, data: "" }));
  assert.equal((await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "FK11FK22FK" }) })).reason, "receipt_not_found");
  okReceipt({ id: "WR11WR22WR", to: "2519****9999" });
  assert.equal((await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "WR11WR22WR" }) })).reason, "wrong_recipient");
  assert.equal(u.balance, 0);
});
test("workflow: ⏳ ደረሰኝ ማምጣት ቢከሽፍ → በእጅ ማረጋገጫ፣ ዋሌት አይነካም", async () => {
  mockAxios(async () => { throw new Error("ECONNRESET"); });
  const u = freshUser();
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "MN11MN22MN" }) });
  assert.equal(r.status, "manual_review");
  assert.equal(u.balance, 0);
  assert.equal(db.txs.find((t) => t.meta.transactionId === "MN11MN22MN").status, "pending");
});
test("workflow: 🚫 ብዙ ያልተሳኩ ሙከራዎች → rate limit", async () => {
  mockAxios(async () => ({ status: 404, data: "" }));
  const u = freshUser();
  for (let i = 0; i < 5; i++) {
    await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: `RL${i}1RL${i}2RL` }) });
  }
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "RL991RL992" }) });
  assert.equal(r.reason, "too_many_attempts");
});

test("workflow: Mongo transaction ባይኖር (standalone) ወደ ተከታታይ ስራ ይወርዳል", async () => {
  const original = mongoose.startSession;
  mongoose.startSession = async () => {
    throw Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { codeName: "IllegalOperation" });
  };
  try {
    okReceipt({ id: "FB11FB22FB" });
    const u = freshUser();
    const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "FB11FB22FB" }) });
    assert.equal(r.status, "approved");
    assert.equal(u.balance, 100);
  } finally {
    mongoose.startSession = original;
  }
});
