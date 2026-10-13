"use strict";
const crypto = require("crypto");
const express = require("express");
const { ingestMerchantSms } = require("../services/telebirr/merchantSms");

const router = express.Router();
router.use(express.urlencoded({ extended: false, limit: "64kb" }));
router.use(express.text({ type: ["text/plain"], limit: "64kb" }));

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

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
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const body =
      typeof req.body === "string" ? { message: req.body } : req.body || {};
    const text = pick(body, ["message", "body", "text", "content", "sms", "msg"]);
    const from = pick(body, ["from", "sender", "address", "number", "phone"]);
    if (!text)
      return res.status(400).json({ ok: false, error: "message_missing" });

    const allowed = String(process.env.MERCHANT_SMS_SENDERS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (
      allowed.length &&
      from &&
      !allowed.includes(String(from).trim().toLowerCase())
    ) {
      return res.status(200).json({ ok: true, ignored: "sender_not_allowed" });
    }

    const r = await ingestMerchantSms({ text, from });
    if (!r.ok) {
      console.warn(
        `[merchant-sms] ⚠️ rejected: ${r.reason} ${(r.errors || []).join(",")}`
      );
      return res
        .status(200)
        .json({ ok: false, reason: r.reason, errors: r.errors });
    }
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
    console.error("[merchant-sms] error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;