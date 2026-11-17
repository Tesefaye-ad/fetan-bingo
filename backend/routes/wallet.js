const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { Notification } = require("../models/User");
const auth = require("./auth");
const { requireAuth } = auth;

const router = express.Router();
router.use(requireAuth);

const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 20);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 100);
const MAX_PENDING_DEPOSITS = 5;

function parseAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1e7) return null;
  return Math.round(n * 100) / 100 === n ? n : null;
}

const PHONE_RE = /^(09|07|\+2519|\+2517|2519|2517)\d{8}$/;

// ═══════════════════════════════════════════════════════
// BALANCE
// ═══════════════════════════════════════════════════════
router.get("/balance", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("balance bonusBalance");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ balance: user.balance, bonusBalance: user.bonusBalance });
  } catch (err) {
    res.status(500).json({ error: "Could not load balance" });
  }
});

// ═══════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════
router.get("/history", async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: "Could not load history" });
  }
});

// ═══════════════════════════════════════════════════════
// DEPOSIT INITIATE
// ═══════════════════════════════════════════════════════
router.post("/deposit/initiate", async (req, res) => {
  try {
    const amount = parseAmount(req.body.amount);
    if (!amount || amount < MIN_DEPOSIT) {
      return res.status(400).json({ error: `Minimum deposit is ${MIN_DEPOSIT} ETB` });
    }
    const pendingCount = await Transaction.countDocuments({
      user: req.userId,
      type: "deposit",
      status: "pending",
      "meta.gateway": "telebirr",
      "meta.transactionId": { $exists: false },
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
    });
    if (pendingCount >= MAX_PENDING_DEPOSITS) {
      return res.status(429).json({
        error: "ብዙ ያልተጠናቀቁ ዲፖዚት ጥያቄዎች አሉ — መጀመሪያ እነሱን ያጠናቅቁ",
      });
    }
    const reference = `DEP-${Date.now()}-${Math.floor(Math.random() * 999999)}`;
    await Transaction.create({
      user: req.userId,
      type: "deposit",
      amount,
      balanceAfter: 0,
      reference,
      status: "pending",
      meta: { gateway: "telebirr" },
    });
    res.json({
      message: `ማስገባት ተጀምሯል — ${amount} ETB`,
      reference,
      amount,
      telebirrPhone: process.env.DEPOSIT_TELEBIRR_PHONE || "0920790583",
    });
  } catch (err) {
    res.status(500).json({ error: "Could not start deposit" });
  }
});

// ═══════════════════════════════════════════════════════
// WITHDRAW
// ═══════════════════════════════════════════════════════
router.post("/withdraw", async (req, res) => {
  try {
    const amount = parseAmount(req.body.amount);
    const { phone, method } = req.body;
    if (!amount || amount < MIN_WITHDRAW) {
      return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAW} ETB` });
    }
    const cleanPhone = String(phone || "").replace(/[^\d+]/g, "");
    if (!PHONE_RE.test(cleanPhone)) {
      return res.status(400).json({ error: "Valid Ethiopian phone required" });
    }

    const user = await User.findOneAndUpdate(
      { _id: req.userId, balance: { $gte: amount }, isBanned: { $ne: true } },
      { $inc: { balance: -amount } },
      { new: true }
    );
    if (!user) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    try {
      await Transaction.create({
        user: user._id,
        type: "withdrawal",
        amount,
        balanceAfter: user.balance,
        status: "pending",
        meta: { phone: cleanPhone, method: method || "telebirr" },
      });
    } catch (txErr) {
      await User.updateOne({ _id: user._id }, { $inc: { balance: amount } });
      throw txErr;
    }
    res.json({ balance: user.balance });
  } catch (err) {
    console.error("[wallet/withdraw]", err);
    res.status(500).json({ error: "Could not process withdrawal" });
  }
});

// ═══════════════════════════════════════════════════════
// 🔴 TRANSFER — Idempotent + Atomic + Fallback
// ═══════════════════════════════════════════════════════
router.post("/transfer", async (req, res) => {
  let session;
  try {
    const amount = parseAmount(req.body.amount);
    const { phone, idempotencyKey } = req.body;

    if (!amount || amount < 10) {
      return res.status(400).json({ error: "Minimum transfer is 10 ETB" });
    }
    if (!phone) {
      return res.status(400).json({ error: "Recipient phone number required" });
    }

    // 🔴 Idempotency key (optional)
    const idemKey =
      typeof idempotencyKey === "string" &&
      idempotencyKey.length >= 8 &&
      idempotencyKey.length <= 128
        ? idempotencyKey
        : null;

    // 🔴 1. Idempotency check FIRST — if this exact transfer already ran, return success
    if (idemKey) {
      const existing = await Transaction.findOne({
        user: req.userId,
        type: "transfer_out",
        "meta.idempotencyKey": idemKey,
      }).lean();
      if (existing) {
        const u = await User.findById(req.userId).select("balance").lean();
        return res.json({ balance: u?.balance ?? 0, idempotent: true });
      }
    }

    let cleanPhone = String(phone || "").replace(/[^\d+]/g, "");
    if (!PHONE_RE.test(cleanPhone)) {
      return res.status(400).json({ error: "Valid Ethiopian phone required (e.g. 0911223344)" });
    }

    let searchPhone = cleanPhone;
    if (searchPhone.startsWith("+251")) {
      searchPhone = "0" + searchPhone.slice(4);
    } else if (searchPhone.startsWith("251")) {
      searchPhone = "0" + searchPhone.slice(3);
    }

    const phoneVariants = [
      searchPhone,
      "+251" + searchPhone.slice(1),
      "251" + searchPhone.slice(1),
    ];

    const recipient = await User.findOne({
      phone: { $in: phoneVariants },
      isBanned: { $ne: true },
    }).select("_id telegramId phone firstName username");

    if (!recipient) {
      return res.status(404).json({ error: "Recipient not found with this phone number" });
    }
    if (String(recipient._id) === String(req.userId)) {
      return res.status(400).json({ error: "Cannot transfer to yourself" });
    }

    let sender, recipientUpdated;

    // 🔴 Helper: Actual Transfer Logic
    const doTransfer = async (sess) => {
      sender = await User.findOneAndUpdate(
        { _id: req.userId, balance: { $gte: amount }, isBanned: { $ne: true } },
        { $inc: { balance: -amount } },
        { new: true, session: sess }
      );
      if (!sender) throw new Error("Insufficient balance");

      recipientUpdated = await User.findOneAndUpdate(
        { _id: recipient._id },
        { $inc: { balance: amount } },
        { new: true, session: sess }
      );
      if (!recipientUpdated) throw new Error("Recipient not found");

      await Transaction.create(
        [
          {
            user: sender._id,
            type: "transfer_out",
            amount,
            balanceAfter: sender.balance,
            counterparty: recipientUpdated._id,
            meta: {
              recipientPhone: searchPhone,
              idempotencyKey: idemKey,
            },
          },
          {
            user: recipientUpdated._id,
            type: "transfer_in",
            amount,
            balanceAfter: recipientUpdated.balance,
            counterparty: sender._id,
            meta: { senderPhone: sender.phone },
          },
        ],
        { session: sess }
      );
    };

    // 🔴 2. Try MongoDB Transaction
    session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await doTransfer(session);
      });
    } catch (e) {
      // 🔴 3. Fallback: If DB doesn't support Transactions (Standalone MongoDB)
      const isNoTxnSupport = 
        e.codeName === "IllegalOperation" || 
        /replica set|Transaction numbers/i.test(e.message || "");

      if (isNoTxnSupport) {
        console.warn("[wallet/transfer] Mongo transactions unavailable — using sequential fallback");
        await session.endSession().catch(() => {});
        session = null;
        await doTransfer(undefined);
      } else {
        throw e;
      }
    }

    // 4. Notify Recipient
    await Notification.create({
      user: recipientUpdated._id,
      title: "💸 Money Received",
      body: `You received ${amount} ETB from ${sender.firstName || sender.username || "a user"}.`,
      type: "success",
    }).catch(() => {});

    res.json({ balance: sender.balance });
  } catch (err) {
    // 🔴 Idempotency race: another request created the same transaction
    if (err.code === 11000 && req.body?.idempotencyKey) {
      const u = await User.findById(req.userId).select("balance").lean();
      return res.json({ balance: u?.balance ?? 0, idempotent: true });
    }
    if (err.message === "Insufficient balance") {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    console.error("[wallet/transfer]", err);
    res.status(500).json({ error: "Could not process transfer" });
  } finally {
    if (session) await session.endSession().catch(() => {});
  }
});

module.exports = router;