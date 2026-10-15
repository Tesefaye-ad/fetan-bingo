"use strict";
// ═══════════════════════════════════════════════════════
// SMS FORWARDER DIAGNOSTICS
// "SMS Forwarder እየላከ ነው ወይስ አይደለም?" ለሚለው ጥያቄ መልስ ይሰጣል።
//   • recordForwarderAttempt() — በ routes/merchantSmsRoute.js ከእያንዳንዱ ጥያቄ በኋላ ይጠራል
//   • smsStatus()   → አድሚን በቦት: /smsstatus
//   • smsCheck(id)  → አድሚን በቦት: /smscheck DJF5T7GTM7
// ሚስጥር (token) በጭራሽ አይታተምም — ርዝመቱ ብቻ።
// ═══════════════════════════════════════════════════════
const MerchantSms = require("../../models/MerchantSms");
const Transaction = require("../../models/Transaction");

// በ RAM ብቻ (ሰርቨሩ ሲጀምር ይጀምራል) — ለመጨረሻው ጥያቄ ብቻ
const last = { at: null, outcome: null, detail: null };
const counts = { total: 0, ok: 0, unauthorized: 0, other: 0 };

function recordForwarderAttempt(outcome, detail) {
  last.at = Date.now();
  last.outcome = outcome;
  last.detail = detail ? String(detail).slice(0, 120) : null;
  counts.total++;
  if (outcome === "ok" || outcome === "duplicate") counts.ok++;
  else if (outcome === "unauthorized") counts.unauthorized++;
  else counts.other++;
}

const OUTCOME_TEXT = {
  ok: "✅ ተቀብሎ አስቀምጧል",
  duplicate: "✅ ተቀብሏል (ድርብ — ቀድሞ ነበር)",
  unauthorized: "❌ 401 — ቶከን አልተመሳሰለም (ወይም ቶከኑ በ ?token= በኩል ተልኳል፤ header ብቻ ይፈቀዳል)",
  not_configured: "❌ 503 — MERCHANT_SMS_TOKEN አልተዘጋጀም (ከ24 ፊደል ያነሰ ወይም የለም)",
  unparseable: "⚠️ SMS ማንበብ አልተቻለም (የቴሌብር 'received' ቅርጽ አይደለም)",
  not_received: "ℹ️ 'ተቀብለዋል' SMS አይደለም (ችላ ተብሏል)",
  sender_ignored: "ℹ️ ላኪው በ MERCHANT_SMS_SENDERS ውስጥ የለም (ችላ ተብሏል)",
  message_missing: "⚠️ ጥያቄው የ SMS ጽሑፍ አልያዘም (የ forwarder ቅንብር ይፈተሽ)",
  error: "❌ የሰርቨር ስህተት",
};

function ago(ms) {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `${s} ሰከንድ በፊት`;
  if (s < 5400) return `${Math.round(s / 60)} ደቂቃ በፊት`;
  if (s < 172800) return `${Math.round(s / 3600)} ሰዓት በፊት`;
  return `${Math.round(s / 86400)} ቀን በፊት`;
}

async function smsStatus(env = process.env) {
  const tokenLen = String(env.MERCHANT_SMS_TOKEN || "").length;
  const now = Date.now();
  const [c1h, c24h, latest] = await Promise.all([
    MerchantSms.countDocuments({ createdAt: { $gte: new Date(now - 3600 * 1000) } }),
    MerchantSms.countDocuments({ createdAt: { $gte: new Date(now - 24 * 3600 * 1000) } }),
    MerchantSms.findOne({}).sort({ createdAt: -1 }).select("txnId amount createdAt smsTimestampRaw").lean(),
  ]);
  return {
    enabled: tokenLen >= 24,
    tokenLen,
    receiptCheck: String(env.RECEIPT_CHECK_ENABLED ?? "true").toLowerCase() !== "false",
    autoApprove: String(env.AUTO_APPROVE_DEPOSITS ?? "true").toLowerCase() !== "false",
    autoLimit: Number(env.MAX_AUTO_DEPOSIT_AMOUNT || 5000),
    senders: String(env.MERCHANT_SMS_SENDERS || "").trim() || null,
    c1h,
    c24h,
    latest,
    lastAttempt: last.at ? { ...last } : null,
    counts: { ...counts },
  };
}

function formatStatus(s) {
  const L = [];
  L.push("📡 SMS Forwarder ሁኔታ", "");
  L.push(
    s.enabled
      ? `✅ የመርቻንት-SMS ማረጋገጫ በርቷል (token ${s.tokenLen} ፊደል)`
      : `❌ የመርቻንት-SMS ማረጋገጫ ጠፍቷል — MERCHANT_SMS_TOKEN ${s.tokenLen ? `አጭር ነው (${s.tokenLen} ፊደል፣ ≥24 ያስፈልጋል)` : "አልተዘጋጀም"}`
  );
  L.push(`🌐 ኢትዮ ቴሌኮም ደረሰኝ ፍተሻ: ${s.receiptCheck ? "በርቷል" : "ጠፍቷል"}`);
  L.push(`🤖 Auto-approve: ${s.autoApprove ? `በርቷል (እስከ ${s.autoLimit} ብር)` : "ጠፍቷል"}`);
  if (s.senders) L.push(`🔎 የላኪ ማጣሪያ: ${s.senders}`);
  L.push("");
  L.push("📥 የተቀበልናቸው SMS:");
  L.push(`   • ባለፈው 1 ሰዓት: ${s.c1h}`);
  L.push(`   • ባለፉት 24 ሰዓት: ${s.c24h}`);
  if (s.latest) {
    L.push(
      `   • የመጨረሻው: ${s.latest.txnId} (${s.latest.amount} ብር) — ${ago(new Date(s.latest.createdAt).getTime())}`
    );
  } else {
    L.push("   • ምንም SMS ገና አልተቀበልንም");
  }
  L.push("");
  if (s.lastAttempt) {
    L.push(
      `🛰 የመጨረሻው የ forwarder ጥያቄ (ከሰርቨር መነሳት ወዲህ): ${ago(s.lastAttempt.at)}`,
      `   ${OUTCOME_TEXT[s.lastAttempt.outcome] || s.lastAttempt.outcome}${s.lastAttempt.detail ? ` — ${s.lastAttempt.detail}` : ""}`,
      `   ጠቅላላ: ${s.counts.total} (✅ ${s.counts.ok} · 401 ${s.counts.unauthorized} · ሌላ ${s.counts.other})`
    );
  } else {
    L.push(
      "🛰 ከሰርቨር መነሳት ወዲህ ምንም የ forwarder ጥያቄ አልደረሰም።",
      "   → መተግበሪያው አይልክም፣ URL የተሳሳተ ነው፣ ወይም ስልኩ ኢንተርኔት የለውም።"
    );
  }
  return L.join("\n");
}

async function smsCheck(txnIdRaw) {
  const txnId = String(txnIdRaw || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{8,14}$/.test(txnId)) return { valid: false, txnId };
  const [rec, tx] = await Promise.all([
    MerchantSms.findOne({ txnId }).lean(),
    Transaction.findOne({ type: "deposit", "meta.transactionId": txnId })
      .select("status amount reference meta createdAt")
      .lean(),
  ]);
  return { valid: true, txnId, rec, tx };
}

function formatCheck(c) {
  if (!c.valid) return "❌ የግብይት ቁጥር ልክ አይደለም። ምሳሌ: /smscheck DJF5T7GTM7";
  const L = [`🔎 ${c.txnId}`, ""];
  if (c.rec) {
    L.push(
      `📥 የመርቻንት SMS: ✅ ተገኝቷል`,
      `   መጠን: ${c.rec.amount} ብር · ሰዓት: ${c.rec.smsTimestampRaw || "—"}`,
      `   ላኪ: ${c.rec.senderName || "—"} ${c.rec.senderPhone || ""}`,
      `   ጥቅም ላይ ውሏል: ${c.rec.claimedBy ? "አዎ (ተወስዷል)" : "አይ"}`
    );
  } else {
    L.push(
      "📥 የመርቻንት SMS: ❌ በዳታቤዝ የለም",
      "   → forwarder ይህን SMS አልላከም (ወይም ማንበብ አልተቻለም)። /smsstatus ይመልከቱ።"
    );
  }
  L.push("");
  if (c.tx) {
    L.push(
      `💳 የዲፖዚት ጥያቄ: ${c.tx.status}`,
      `   ${c.tx.amount} ብር · Ref ${c.tx.reference}`,
      `   ምክንያት: ${(c.tx.meta && c.tx.meta.verificationReason) || "—"}`
    );
  } else {
    L.push("💳 የዲፖዚት ጥያቄ: የለም (ተጠቃሚው ገና አልለጠፈም)");
  }
  return L.join("\n");
}

module.exports = { recordForwarderAttempt, smsStatus, formatStatus, smsCheck, formatCheck, OUTCOME_TEXT };
