"use strict";
// ═══════════════════════════════════════════════════════
// MERCHANT SMS — የመርቻንት ስልክ የተቀበለው የቴሌብር SMS
//
// ክፍያ ሲገባ የመርቻንት ስልክ "You have received ETB ..." የሚል SMS ይቀበላል።
// SMS Forwarder መተግበሪያ ወደ /api/merchant-sms/incoming ይልከዋል፣ እዚህ ይቀመጣል።
// ተጠቃሚው SMS ሲለጥፍ የግብይት ቁጥሩ እና መጠኑ ከዚህ ጋር ይመሳሰላል (ኢትዮ ቴሌኮም ድረ-ገጽ አያስፈልግም)።
// ═══════════════════════════════════════════════════════
const MerchantSms = require("../../models/MerchantSms");
const Transaction = require("../../models/Transaction");
const { parseTelebirrSms } = require("./smsParser");

const cents = (n) => Math.round(Number(n) * 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ለሙከራ: አድሚን የሚጠቀምበትን approveTransaction መተካት
let approver = null;
const setApprover = (fn) => { approver = fn; };
const getApprover = () => approver || require("../deposits").approveTransaction;

// "... received ETB 50.00 from TESFAYE ADMASU(2519****9894) on ..." (best-effort)
// አማርኛ: "ከ TESFAYE ADMASU(2519****9894) 50.00 ብር በ ... ተቀብለዋል"
function extractSender(raw) {
  const m =
    /\bfrom\s+(.+?)\s*[\(\-]\s*(\+?\d[\d*]{7,})\)?/i.exec(raw) ||
    /ከ\s+(.+?)\s*\(\s*(\+?\d[\d*]{7,})\s*\)/.exec(raw);
  return m ? { name: m[1].trim(), phone: m[2] } : { name: null, phone: null };
}

// ─── 1) መቀበል እና ማስቀመጥ ───
async function ingestMerchantSms({ text, from }) {
  const p = parseTelebirrSms(text);
  if (!p.ok) return { ok: false, reason: "unparseable", errors: p.errors };
  if (p.direction !== "received") return { ok: false, reason: "not_a_received_sms" };

  const sender = extractSender(p.raw);
  let rec;
  let duplicate = false;
  try {
    rec = await MerchantSms.create({
      txnId: p.txnId,
      amount: p.amount,
      senderName: sender.name,
      senderPhone: sender.phone,
      smsTimestampMs: p.timestamp ? p.timestamp.ms : null,
      smsTimestampRaw: p.timestamp ? p.timestamp.raw : null,
      from: from ? String(from).slice(0, 40) : null,
      raw: p.raw.slice(0, 500),
      fingerprint: p.fingerprint,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      duplicate = true;
      rec = await MerchantSms.findOne({ txnId: p.txnId });
    } else {
      throw err;
    }
  }

  // ተጠቃሚው ቀድሞ SMS ለጥፎ በእጅ ማረጋገጫ ላይ ከሆነ → አሁን በራስ ሰር ይጸድቃል
  const approved = rec ? await approvePendingFor(rec).catch((e) => {
    console.error("[merchant-sms] auto-approve failed:", e.message);
    return null;
  }) : null;

  return { ok: true, duplicate, txnId: p.txnId, amount: p.amount, autoApproved: !!(approved && approved.ok) };
}

// ─── 2) መፈለግ / መጠበቅ ───
const findMerchantSms = (txnId) =>
  MerchantSms.findOne({ txnId: String(txnId).toUpperCase() });

// SMS ከስልኩ በጥቂት ሰኮንዶች ሊዘገይ ስለሚችል ትንሽ እንጠብቃለን
async function waitForMerchantSms(txnId, seconds, stepMs = 2000) {
  const polls = Math.ceil((Number(seconds) * 1000) / stepMs);
  for (let i = 0; i < polls; i++) {
    await sleep(stepMs);
    const rec = await findMerchantSms(txnId);
    if (rec) return rec;
  }
  return null;
}

// ═══════════════════════════════════════════════════════
// 👈 FIX: 24-hour window only — removed strict time_mismatch
// ═══════════════════════════════════════════════════════
function matchMerchantSms(rec, { expectedAmount, userSmsMs, maxAgeHours = 24 }) {
  const now = Date.now();
  const fail = (reason, message) => ({ ok: false, reason, message });

  if (rec.claimedBy) {
    return fail("duplicate", "ይህ ግብይት ከዚህ በፊት ጥቅም ላይ ውሏል");
  }
  if (cents(rec.amount) !== cents(expectedAmount)) {
    return fail(
      "amount_mismatch",
      `የደረሰን መጠን (${rec.amount}) ከ SMS መጠን (${expectedAmount}) ጋር አይመሳሰልም`
    );
  }

  // ═══════════════════════════════════════════════════════
  // 👈 time_mismatch check REMOVED.
  //    The user SMS and merchant SMS should have the same
  //    timestamp (both come from the same Ethio Telecom event),
  //    but parsing/regex differences and timezone quirks can
  //    cause ±1-2 min drift. That was rejecting valid payments.
  //    We now only check the 24-hour freshness window.
  // ═══════════════════════════════════════════════════════

  const ts = rec.smsTimestampMs;
  if (ts) {
    if (ts > now + 5 * 60 * 1000) {
      return fail("future_dated", "የክፍያ ቀኑ ትክክል አይደለም");
    }
    if ((now - ts) / 3600000 > maxAgeHours) {
      return fail("stale", `ክፍያው ከ ${maxAgeHours} ሰዓት በላይ አሮጌ ነው`);
    }
  }

  return {
    ok: true,
    data: {
      amount: rec.amount,
      payerName: rec.senderName || null,
      payerPhone: rec.senderPhone || null,
      paymentDate: rec.smsTimestampRaw || null,
    },
  };
}

async function markClaimed(txnId, userId) {
  try {
    await MerchantSms.updateOne(
      { txnId: String(txnId).toUpperCase(), claimedBy: null },
      { $set: { claimedBy: userId, claimedAt: new Date() } }
    );
  } catch (err) {
    console.error("[merchant-sms] markClaimed failed:", err.message);
  }
}

// ─── 4) በእጅ ማረጋገጫ ላይ የቆመ ክፍያ ካለ በራስ ሰር ማጽደቅ ───
const NEVER_AUTO = new Set(["exceeds_auto_limit", "auto_approve_disabled"]);
async function approvePendingFor(rec) {
  if (rec.claimedBy) return null;
  const tx = await Transaction.findOne({
    type: "deposit",
    status: "pending",
    "meta.transactionId": rec.txnId,
    "meta.requiresManualReview": true,
  });
  if (!tx) return null;
  if (NEVER_AUTO.has(tx.meta && tx.meta.verificationReason)) return null; // አድሚን ራሱ ይወስናል
  if (cents(tx.amount) !== cents(rec.amount)) return { ok: false, reason: "amount_mismatch" };

  const maxAuto = Number(process.env.MAX_AUTO_DEPOSIT_AMOUNT || 5000);
  const autoOn = String(process.env.AUTO_APPROVE_DEPOSITS ?? "true").toLowerCase() !== "false";
  if (!autoOn || (maxAuto > 0 && rec.amount > maxAuto)) return null;

  const r = await getApprover()(tx._id);
  if (r && r.ok) await markClaimed(rec.txnId, tx.user);
  return r;
}

module.exports = {
  ingestMerchantSms,
  findMerchantSms,
  waitForMerchantSms,
  matchMerchantSms,
  markClaimed,
  approvePendingFor,
  extractSender,
  setApprover,
};