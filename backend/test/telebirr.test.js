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
const db = { users: [], txs: [], msms: [] };
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
const FakeMerchantSms = {
  create: async (d) => {
    if (db.msms.some((m) => m.txnId === d.txnId)) {
      throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    }
    const m = { _id: `ms${++seq}`, createdAt: new Date(), claimedBy: null, ...d };
    db.msms.push(m);
    return m;
  },
  findOne: (f) => thenable(db.msms.find((m) => m.txnId === f.txnId) || null),
  updateOne: async (f, upd) => {
    const m = db.msms.find((x) => x.txnId === f.txnId && !x.claimedBy);
    if (m) Object.assign(m, upd.$set);
    return {};
  },
};
// ⚠️ እውነተኛው bot.js እንዳይጫን (እውነተኛ Telegram መልዕክት እንዳይልክ) በሐሰተኛ እንተካዋለን
const sentMessages = [];
const FakeBot = { bot: { telegram: { sendMessage: async (id, text) => { sentMessages.push({ id, text }); } } } };
for (const [rel, exp] of [["../models/User", FakeUser], ["../models/Transaction", FakeTx], ["../models/MerchantSms", FakeMerchantSms], ["../bot", FakeBot]]) {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exp };
}
mongoose.startSession = async () => ({ withTransaction: (fn) => fn(), endSession: async () => {} });
const { verifyAndCreditDeposit } = require("../services/telebirr/depositVerifier");
const { parseTelebirrSms } = require("../services/telebirr/smsParser");
const merchantSms = require("../services/telebirr/merchantSms");
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

// ትክክለኛውን የኢትዮ ቴሌኮም ደረሰኝ አወቃቀር ይመስላል:
//  • መለያዎች "አማርኛ/English" ናቸው
//  • Invoice No / Payment date / Settled Amount መለያዎች በአንድ ረድፍ፣ እሴቶቹ በቀጣዩ ረድፍ
//  • የ "transaction status" <td> አልተዘጋም (እንደ እውነተኛው ገጽ)
const receiptHtml = (o = {}) => {
  const amt = `${o.amount || "100.00"} Birr`;
  const kv = (l, v) => `<tr><td>${l}</td><td>${v}</td></tr>`;
  return `<html><body><!-- ${"x".repeat(600)} -->
  <table><tr><td><table><tr><td>Ethio telecom Share Company</td></tr><tr><td>TIN No.</td><td>0000030603</td></tr></table></td></tr>
  <tr><td>የቴሌብር ክፍያ መረጃ/telebirr Transaction information</td></tr>
  <tr><td><table>
    ${kv("የከፋይ ስም/Payer Name", "Abebe K***")}
    ${kv("የከፋይ ቴሌብር ቁ./Payer telebirr no.", "2519****1234")}
    ${kv("የከፋይ ቲን ቁ./ Payer TIN No", "")}
    ${kv("የከፋይ ተ.እ.ታ.ቁ./VAT Reg. No", "")}
    ${kv("የገንዘብ ተቀባይ ስም/Credited Party name", o.name || "Fetan Bingo")}
    ${kv("የገንዘብ ተቀባይ ቴሌብር ቁ./Credited party account no", o.to || "2519****0583")}
    <tr><td>የክፍያው ሁኔታ/transaction status
        <td>${o.status || "Completed"}</td></tr>
  </table></td></tr>
  <tr><td><table>
    <tr><td>የክፍያ ዝርዝር/ Invoice details</td><td>የክፍያ ቁጥር/Invoice No.</td><td>የክፍያ ቀን/Payment date</td><td>የተከፈለው መጠን/Settled Amount</td></tr>
    <tr><td></td><td>${o.id || "DJ85JP3L6V"}</td><td>${o.date || "08-10-2026 08:31:50"}</td><td>${amt}</td></tr>
    ${kv("የአገልግሎት ክፍያ/Service fee", "0.00 Birr")}
    ${kv("ጠቅላላ የተከፈለ/Total Paid Amount", amt)}
  </table></td></tr></table></body></html>`;
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

// ─── Relay (Render → ኢትዮጵያ ውስጥ ያለ relay → ኢትዮ ቴሌኮም) ───
const withRelayEnv = async (fn) => {
  process.env.RECEIPT_RELAY_URL = "https://relay.example.com/";
  process.env.RECEIPT_RELAY_TOKEN = "t".repeat(32);
  try { await fn(); } finally {
    delete process.env.RECEIPT_RELAY_URL;
    delete process.env.RECEIPT_RELAY_TOKEN;
  }
};
test("relay: ትክክለኛ ደረሰኝ በ relay በኩል ይመጣል (ቶከን ይላካል፣ ቀጥታ ወደ ኢትዮ ቴሌኮም አይሄድም)", () => withRelayEnv(async () => {
  const seen = [];
  mockAxios(async (url, cfg) => {
    seen.push({ url, token: cfg.headers["x-relay-token"] });
    return { status: 200, data: receiptHtml({ id: "RL11RL22RL" }) };
  });
  const r = await verifyReceipt({ txnId: "RL11RL22RL", expectedAmount: 100, merchant: base.merchant, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://relay.example.com/receipt/RL11RL22RL");
  assert.equal(seen[0].token, "t".repeat(32));
}));
test("relay: 404 'receipt_not_found' → ሃሰተኛ ደረሰኝ", () => withRelayEnv(async () => {
  mockAxios(async () => ({ status: 404, data: "receipt_not_found" }));
  const r = await verifyReceipt({ txnId: "RL33RL44RL", expectedAmount: 100, merchant: base.merchant, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "receipt_not_found");
}));
test("relay: relay ባይሠራ (502/ኔትወርክ) → fetch_failed (በእጅ ማረጋገጫ)", () => withRelayEnv(async () => {
  mockAxios(async () => { throw new Error("ECONNREFUSED"); });
  const r = await verifyReceipt({ txnId: "RL55RL66RL", expectedAmount: 100, merchant: base.merchant, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "fetch_failed");
  assert.equal(r.manualReview, true);
}));
test("relay: ያለ https ቶከን አይላክም", async () => {
  process.env.RECEIPT_RELAY_URL = "http://relay.example.com";
  process.env.RECEIPT_RELAY_TOKEN = "t".repeat(32);
  let called = false;
  try {
    mockAxios(async () => { called = true; return { status: 200, data: "" }; });
    const r = await verifyReceipt({ txnId: "RL77RL88RL", expectedAmount: 100, merchant: base.merchant, now: NOW });
    assert.equal(r.reason, "fetch_failed");
    assert.equal(called, false);
  } finally {
    delete process.env.RECEIPT_RELAY_URL;
    delete process.env.RECEIPT_RELAY_TOKEN;
  }
});


// ───────────── የመርቻንት ስልክ SMS ማረጋገጫ ─────────────
const receivedSms = (o = {}) =>
  `Dear Fetan You have received ETB ${o.amount || "100.00"} from ABEBE KEBEDE (2519****1234) on ` +
  `${o.date || "08/10/2026 08:31:50"}. Your transaction number is ${o.id || "DJ85JP3L6V"}. ` +
  `Your current E-Money Account balance is ETB 900.00. Thank you for using telebirr`;
const withMerchantEnv = async (extra, fn) => {
  const keys = { MERCHANT_SMS_TOKEN: "m".repeat(32), MERCHANT_SMS_WAIT_SECONDS: "0", ...extra };
  for (const [k, v] of Object.entries(keys)) process.env[k] = v;
  const fakeApprove = async (id) => {
    const tx = db.txs.find((t) => t._id === id);
    if (!tx || tx.status !== "pending") return { ok: false };
    tx.status = "completed";
    const u = db.users.find((x) => String(x._id) === String(tx.user));
    u.balance += tx.amount;
    return { ok: true, transaction: tx, user: u };
  };
  merchantSms.setApprover(fakeApprove);
  try { await fn(); } finally {
    for (const k of Object.keys(keys)) delete process.env[k];
    merchantSms.setApprover(null);
  }
};

test("merchant-sms: የተቀበልነው SMS ይቀመጣል፤ 'የላኩበት' SMS እና ድርብ ይያዛሉ", async () => {
  const r1 = await merchantSms.ingestMerchantSms({ text: receivedSms({ id: "IN11IN22IN" }), from: "127" });
  assert.equal(r1.ok, true);
  assert.equal(r1.amount, 100);
  const rec = db.msms.find((m) => m.txnId === "IN11IN22IN");
  assert.equal(rec.senderPhone, "2519****1234");
  const r2 = await merchantSms.ingestMerchantSms({ text: receivedSms({ id: "IN11IN22IN" }) });
  assert.equal(r2.duplicate, true);
  assert.equal(db.msms.filter((m) => m.txnId === "IN11IN22IN").length, 1);
  const r3 = await merchantSms.ingestMerchantSms({ text: sms({ id: "IN33IN44IN" }) }); // transferred
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, "not_a_received_sms");
  assert.equal((await merchantSms.ingestMerchantSms({ text: "hello" })).ok, false);
});

test("merchant-sms: SMS ከደረሰ → ያለ ድረ-ገጽ ጥሪ ይጸድቃል", () => withMerchantEnv({}, async () => {
  let calls = 0;
  mockAxios(async () => { calls++; throw new Error("must not be called"); });
  await merchantSms.ingestMerchantSms({ text: receivedSms({ id: "MS11MS22MS" }) });
  const u = freshUser();
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "MS11MS22MS" }) });
  assert.equal(r.status, "approved");
  assert.equal(u.balance, 100);
  assert.equal(calls, 0);
  assert.equal(db.msms.find((m) => m.txnId === "MS11MS22MS").claimedBy, u._id);
  const tx = db.txs.find((t) => t.meta && t.meta.transactionId === "MS11MS22MS");
  assert.equal(tx.meta.receiptVia, "merchant_sms");
  // ተመሳሳዩ SMS በሌላ ሰው → ድርብ
  const u2 = freshUser();
  const r2 = await verifyAndCreditDeposit({ userId: u2._id, smsText: sms({ id: "MS11MS22MS" }) });
  assert.equal(r2.status, "rejected");
  assert.equal(r2.reason, "duplicate");
}));

test("merchant-sms: መጠን ካልተመሳሰለ → አይጸድቅም፣ ወደ አድሚን", () => withMerchantEnv({}, async () => {
  mockAxios(async () => { throw new Error("must not be called"); });
  await merchantSms.ingestMerchantSms({ text: receivedSms({ id: "MM11MM22MM", amount: "50.00" }) });
  const u = freshUser();
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "MM11MM22MM", amount: "100.00" }) });
  assert.equal(r.status, "manual_review");
  assert.equal(r.reason, "amount_mismatch");
  assert.equal(u.balance, 0);
}));

test("merchant-sms: SMS ገና ካልደረሰ → ተይዞ ይጠብቃል፤ SMS ሲደርስ በራስ ሰር ይጸድቃል", () =>
  withMerchantEnv({ RECEIPT_CHECK_ENABLED: "false" }, async () => {
    let calls = 0;
    mockAxios(async () => { calls++; throw new Error("must not be called"); });
    const u = freshUser();
    const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "AW11AW22AW" }) });
    assert.equal(r.status, "manual_review");
    assert.equal(r.reason, "awaiting_merchant_sms");
    assert.equal(u.balance, 0);
    assert.equal(calls, 0);
    // የመርቻንት SMS ዘግይቶ ደረሰ
    const ing = await merchantSms.ingestMerchantSms({ text: receivedSms({ id: "AW11AW22AW" }) });
    assert.equal(ing.autoApproved, true);
    assert.equal(u.balance, 100);
    assert.equal(db.txs.find((t) => t.meta && t.meta.transactionId === "AW11AW22AW").status, "completed");
  }));

test("merchant-sms: SMS ከደረሰ ግን መጠኑ ከተጠየቀው ቢለይ በራስ ሰር አይጸድቅም", () =>
  withMerchantEnv({ RECEIPT_CHECK_ENABLED: "false" }, async () => {
    const u = freshUser();
    await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "AX11AX22AX", amount: "100.00" }) });
    const ing = await merchantSms.ingestMerchantSms({ text: receivedSms({ id: "AX11AX22AX", amount: "20.00" }) });
    assert.equal(ing.autoApproved, false);
    assert.equal(u.balance, 0);
  }));


// ─── እውነተኛ የአማርኛ SMS (ተቀብለዋል) ───
const AM_RECEIVED = `ውድ Tesfaye 
ከ TESFAYE ADMASU(2519****9894) 50.00 ብር በ 13/10/2026 11:56:09 ተቀብለዋል፡፡ የሂሳብ እንቅስቃሴ ቁጥርዎ DJD9QRJ18X ነዉ፡፡ አሁን ያለዎት ቀሪ ሂሳብ 121.10 ብር ነዉ፡፡ 
በቴሌብር ስለተገለገሉ እናመሰግናለን 
ኢትዮ ቴሌኮም`;
test("parser: እውነተኛ የአማርኛ 'ተቀብለዋል' SMS (ቀሪ ሂሳብ አይያዝም)", () => {
  const r = parseTelebirrSms(AM_RECEIVED);
  assert.equal(r.ok, true);
  assert.equal(r.txnId, "DJD9QRJ18X");
  assert.equal(r.amount, 50);
  assert.equal(r.direction, "received");
  assert.equal(r.timestamp.iso, "2026-10-13T11:56:09+03:00");
});
test("merchant-sms: የአማርኛ SMS ይቀመጣል፣ ላኪው ይለያል", async () => {
  const r = await merchantSms.ingestMerchantSms({ text: AM_RECEIVED, from: "127" });
  assert.equal(r.ok, true);
  assert.equal(r.txnId, "DJD9QRJ18X");
  const rec = db.msms.find((m) => m.txnId === "DJD9QRJ18X");
  assert.equal(rec.amount, 50);
  assert.equal(rec.senderName, "TESFAYE ADMASU");
  assert.equal(rec.senderPhone, "2519****9894");
});
test("merchant-sms: በ Render ተይዞ የነበረው ክፍያ (DJD9QRJ18X) SMS ሲደርስ በራስ ሰር ይጸድቃል", () =>
  withMerchantEnv({ RECEIPT_CHECK_ENABLED: "false" }, async () => {
    mockAxios(async () => { throw new Error("must not be called"); });
    db.msms = db.msms.filter((m) => m.txnId !== "DJD9QRJ18X");
    const u = freshUser();
    const userSms = `Dear TESFAYE You have transferred ETB 50.00 to Tesfaye Admasu (2519****0583) on 13/10/2026 11:56:09. Your transaction number is DJD9QRJ18X. The service fee is ETB 0.87 and 15% VAT on the service fee is ETB 0.13. Your current E-Money Account balance is ETB 621.99. To download your payment information please click this link: https://transactioninfo.ethiotelecom.et/receipt/DJD9QRJ18X.`;
    const r = await verifyAndCreditDeposit({ userId: u._id, smsText: userSms });
    assert.equal(r.status, "manual_review");
    assert.equal(r.reason, "awaiting_merchant_sms");
    const ing = await merchantSms.ingestMerchantSms({ text: AM_RECEIVED, from: "127" });
    assert.equal(ing.autoApproved, true);
    assert.equal(u.balance, 50);
  }));

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
test("workflow: ⚠️ ሲስተሙ ያላጸደቀው (ሃሰተኛ 404 / የተሳሳተ ተቀባይ) → ወደ አድሚን፣ ዋሌት አይነካም", async () => {
  const u = freshUser();
  mockAxios(async () => ({ status: 404, data: "" }));
  const r1 = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "FK11FK22FK" }) });
  assert.equal(r1.status, "manual_review");
  assert.equal(r1.reason, "receipt_not_found");
  okReceipt({ id: "WR11WR22WR", to: "2519****9999" });
  const r2 = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "WR11WR22WR" }) });
  assert.equal(r2.status, "manual_review");
  assert.equal(r2.reason, "wrong_recipient");
  assert.equal(u.balance, 0);
  const q = db.txs.find((t) => t.meta && t.meta.transactionId === "WR11WR22WR");
  assert.equal(q.status, "pending");
  assert.equal(q.meta.requiresManualReview, true);
  assert.equal(q.meta.receiptVerified, false);
});
test("workflow: ✅ ሲስተሙ ካጸደቀው ወደ አድሚን አይሄድም", async () => {
  const u = freshUser();
  okReceipt({ id: "OK11OK22OK" });
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "OK11OK22OK" }) });
  assert.equal(r.status, "approved");
  const tx = db.txs.find((t) => t.meta && t.meta.transactionId === "OK11OK22OK");
  assert.equal(tx.status, "completed");
  assert.notEqual(tx.meta.requiresManualReview, true);
});
test("workflow: MANUAL_REVIEW_ON_REJECT=false → አለመመሳሰል ወዲያው ውድቅ", async () => {
  process.env.MANUAL_REVIEW_ON_REJECT = "false";
  try {
    const u = freshUser();
    okReceipt({ id: "RJ11RJ22RJ", to: "2519****9999" });
    const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "RJ11RJ22RJ" }) });
    assert.equal(r.status, "rejected");
    assert.equal(r.reason, "wrong_recipient");
  } finally {
    delete process.env.MANUAL_REVIEW_ON_REJECT;
  }
});
test("workflow: ⏳ ኢትዮ ቴሌኮም ባይመልስ (ነባሪ) → በእጅ ማረጋገጫ፣ ዋሌት አይነካም", async () => {
  mockAxios(async () => { throw new Error("ECONNRESET"); });
  const u = freshUser();
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "MN11MN22MN" }) });
  assert.equal(r.status, "manual_review");
  assert.equal(u.balance, 0);
  assert.equal(db.txs.find((t) => t.meta.transactionId === "MN11MN22MN").status, "pending");
});
test("workflow: ⏳ MANUAL_REVIEW_ON_FETCH_FAIL=false → ውድቅ፣ ቁጥሩ አይቃጠልም", async () => {
  process.env.MANUAL_REVIEW_ON_FETCH_FAIL = "false";
  process.env.MANUAL_REVIEW_ON_REJECT = "false";
  try {
    mockAxios(async () => { throw new Error("ECONNRESET"); });
    const u = freshUser();
    const r = await verifyAndCreditDeposit({ userId: u._id, smsText: sms({ id: "MR11MR22MR" }) });
    assert.equal(r.status, "rejected");
    assert.equal(r.reason, "fetch_failed");
    assert.equal(u.balance, 0);
    assert.equal(db.txs.some((t) => t.meta && t.meta.transactionId === "MR11MR22MR"), false);
  } finally {
    delete process.env.MANUAL_REVIEW_ON_FETCH_FAIL;
    delete process.env.MANUAL_REVIEW_ON_REJECT;
  }
});
test("workflow: ❌ ያለ ደረሰኝ ሊንክ የተለጠፈ SMS → ውድቅ", async () => {
  okReceipt({ id: "NL11NL22NL" });
  const u = freshUser();
  const noLink = sms({ id: "NL11NL22NL" }).replace(/https?:\/\/\S+/, "");
  const r = await verifyAndCreditDeposit({ userId: u._id, smsText: noLink });
  assert.equal(r.status, "rejected");
  assert.equal(r.reason, "receipt_link_missing");
  assert.equal(u.balance, 0);
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
