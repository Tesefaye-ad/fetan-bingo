"use strict";
// POST /api/wallet/deposit/verify
// body: { sms: string, reference?: string }
const express = require("express");
const { requireAuth } = require("./auth");
const {
  verifyAndCreditDeposit,
} = require("../services/telebirr/depositWorkflow");

const router = express.Router();
router.use(requireAuth);

router.post("/deposit/verify", async (req, res) => {
  try {
    const { sms, reference } = req.body || {};

    // Input validation
    if (
      typeof sms !== "string" ||
      sms.trim().length < 20 ||
      sms.length > 2000
    ) {
      return res.status(400).json({
        ok: false,
        status: "rejected",
        message: "❌ የ Telebirr SMS ሙሉውን ይለጥፉ",
      });
    }

    const { httpStatus, ...body } = await verifyAndCreditDeposit({
      userId: req.userId,
      smsText: sms,
      reference: typeof reference === "string" ? reference : undefined,
    });

    res
      .status(httpStatus || (body.ok ? 200 : 422))
      .json(body);
  } catch (err) {
    console.error("[deposit/verify]", err);
    res.status(500).json({
      ok: false,
      status: "error",
      message: "ስህተት ተፈጥሯል፣ እንደገና ይሞክሩ",
    });
  }
});

module.exports = router;