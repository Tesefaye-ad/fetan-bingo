"use strict";
const crypto = require("crypto");
const express = require("express");
const { ingestMerchantSms } = require("../services/telebirr/merchantSms");
const { recordForwarderAttempt } = require("../services/telebirr/smsDiagnostics");

const router = express.Router();
router.use(express.urlencoded({ extended: false, limit: "64kb" }));
router.use(express.text({ type: ["text/plain"], limit: "64kb" }));

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// 401/503 ቀደም ሲል ዝም ብለው ይመለሱ ነበር (ምንም ሎግ አልነበረም) — አሁን በደቂቃ አንድ ጊዜ ይታተማሉ
let lastWarnAt = 0;
function warnOncePerMinute(msg) {
  if (Date.now() - lastWarnAt > 60000) {
    lastWarnAt = Date.now();
    console.warn(msg);
  }
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && typeof obj[k] === "string" && obj[k].trim()) return obj[k];
  }
  return null;
}

router.post("/incoming", async (req, res) => {
  try {
    const TOKEN = process.env.MERCHANT_SMS_TOKEN || "";
    if (TOKEN.length < 24) {
      recordForwarderAttempt("not_configured");
      warnOncePerMinute("[merchant-sms] ❌ 503 — MERCHANT_SMS_TOKEN not set / shorter than 24 chars");
      return res
        .status(503)
        .json({ ok: false, error: "merchant_sms_not_configured" });
    }

    // ═══════════════════════════════════════════════════════
    // 👈 FIX #9: header only. `?token=` REMOVED — query strings
    //    land in access logs, proxy logs, and browser history.
    // ═══════════════════════════════════════════════════════
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
    const given = req.headers["x-forwarder-token"] || (bearer && bearer[1]);
    if (!safeEqual(given, TOKEN)) {
      const viaQuery = !given && req.query && req.query.token ? " (token ?token= በኩል ተልኳል — header ብቻ ይፈቀዳል)" : "";
      recordForwarderAttempt("unauthorized", viaQuery ? "?token=" : given ? "wrong token" : "no token header");
      warnOncePerMinute(`[merchant-sms] ❌ 401 unauthorized${viaQuery}`);
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const body =
      typeof req.body === "string" ? { message: req.body } : req.body || {};
    const text = pick(body, ["message", "body", "text", "content", "sms", "msg"]);
    const from = pick(body, ["from", "sender", "address", "number", "phone"]);
    if (!text) {
      recordForwarderAttempt("message_missing", `body keys: ${Object.keys(body || {}).join(",") || "(none)"}`);
      warnOncePerMinute(`[merchant-sms] ⚠️ 400 message missing — body keys: ${Object.keys(body || {}).join(",") || "(none)"}`);
      return res.status(400).json({ ok: false, error: "message_missing" });
    }

    const allowed = String(process.env.MERCHANT_SMS_SENDERS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (
      allowed.length &&
      from &&
      !allowed.includes(String(from).trim().toLowerCase())
    ) {
      recordForwarderAttempt("sender_ignored", String(from).slice(0, 30));
      return res.status(200).json({ ok: true, ignored: "sender_not_allowed" });
    }

    const r = await ingestMerchantSms({ text, from });
    if (!r.ok) {
      recordForwarderAttempt(
        r.reason === "not_a_received_sms" ? "not_received" : "unparseable",
        r.reason === "unparseable" ? (r.errors || []).join(",") : null
      );
      console.warn(
        `[merchant-sms] ⚠️ rejected: ${r.reason} ${(r.errors || []).join(",")}`
      );
      return res
        .status(200)
        .json({ ok: false, reason: r.reason, errors: r.errors });
    }
    recordForwarderAttempt(r.duplicate ? "duplicate" : "ok", r.txnId);
    console.log(
      `[merchant-sms] ✅ ${r.txnId} ${r.amount} ETB${
        r.duplicate ? " (dup)" : ""
      }${r.autoApproved ? " → auto-approved" : ""}`
    );
    return res.json({
      ok: true,
      txnId: r.txnId,
      autoApproved: r.autoApproved,
    });
  } catch (err) {
    recordForwarderAttempt("error", err && err.message);
    console.error("[merchant-sms] error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;