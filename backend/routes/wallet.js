const express = require("express");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { Notification } = require("../models/User");
const auth = require("./auth");
const { requireAuth } = auth;

const router = express.Router();
router.use(requireAuth);

const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 20);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const MAX_PENDING_DEPOSITS = 5; // በሰዓት ውስጥ — spam መከላከያ

// ብር መጠን: ውሱን ቁጥር፣ ከ 0 በላይ፣ ቢበዛ 2 ዲጂት ከነጥብ በኋላ
function parseAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1e7) return null;
  return Math.round(n * 100) / 100 === n ? n : null;
}

const PHONE_RE = /^(09|07|\+2519|\+2517|2519|2517)\d{8}$/;

router.get("/balance", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("balance bonusBalance");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ balance: user.balance, bonusBalance: user.bonusBalance });
  } catch (err) {
    res.status(500).json({ error: "Could not load balance" });
  }
});

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

router.post("/deposit/initiate", async (req, res) => {
  try {
    const amount = parseAmount(req.body.amount);
    if (!amount || amount < MIN_DEPOSIT) {
      return res
        .status(400)
        .json({ error: `Minimum deposit is ${MIN_DEPOSIT} ETB` });
    }
    const pendingCount = await Transaction.countDocuments({
      user: req.userId,
      type: "deposit",
      status: "pending",
      "meta.gateway": "telebirr",
      "meta.transactionId": { $exists: false },
      // ባለፈው ሰዓት ውስጥ ብቻ — የድሮ ያልተጠናቀቁ ጥያቄዎች ተጠቃሚውን ለዘላለም እንዳይቆልፉ
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

router.post("/withdraw", async (req, res) => {
  try {
    const amount = parseAmount(req.body.amount);
    const { phone, method } = req.body;
    if (!amount || amount < MIN_WITHDRAW) {
      return res
        .status(400)
        .json({ error: `Minimum withdrawal is ${MIN_WITHDRAW} ETB` });
    }
    const cleanPhone = String(phone || "").replace(/[^\d+]/g, "");
    if (!PHONE_RE.test(cleanPhone)) {
      return res.status(400).json({ error: "Valid Ethiopian phone required" });
    }

    // atomic: ቀሪ ሂሳብ በቂ ከሆነ ብቻ ይቀነሳል (ሁለት ጥያቄ በአንድ ጊዜ ቢላክ አይደገምም)
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
      // መዝገብ ካልተፈጠረ ብሩን መልስ — ያለ ምንም ዱካ እንዳይጠፋ
      await User.updateOne({ _id: user._id }, { $inc: { balance: amount } });
      throw txErr;
    }
    res.json({ balance: user.balance });
  } catch (err) {
    console.error("[wallet/withdraw]", err);
    res.status(500).json({ error: "Could not process withdrawal" });
  }
});

router.post("/transfer", async (req, res) => {
  try {
    const amount = parseAmount(req.body.amount);
    const { toTelegramId } = req.body;
    if (!amount) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    if (!toTelegramId) {
      return res.status(400).json({ error: "Recipient required" });
    }

    const recipient = await User.findOne({
      telegramId: String(toTelegramId),
      isBanned: { $ne: true },
    }).select("_id telegramId");
    if (!recipient) return res.status(404).json({ error: "Recipient not found" });
    if (String(recipient._id) === String(req.userId)) {
      return res.status(400).json({ error: "Cannot transfer to yourself" });
    }

    // atomic: ላኪ ሂሳብ በቂ ከሆነ ብቻ ይቀነሳል
    const sender = await User.findOneAndUpdate(
      { _id: req.userId, balance: { $gte: amount }, isBanned: { $ne: true } },
      { $inc: { balance: -amount } },
      { new: true }
    );
    if (!sender) return res.status(400).json({ error: "Insufficient balance" });

    const recipientUpdated = await User.findOneAndUpdate(
      { _id: recipient._id },
      { $inc: { balance: amount } },
      { new: true }
    );
    if (!recipientUpdated) {
      // ተቀባይ ጠፍቷል — መልስ
      await User.updateOne({ _id: sender._id }, { $inc: { balance: amount } });
      return res.status(404).json({ error: "Recipient not found" });
    }

    await Transaction.create([
      {
        user: sender._id,
        type: "transfer_out",
        amount,
        balanceAfter: sender.balance,
        counterparty: recipientUpdated._id,
      },
      {
        user: recipientUpdated._id,
        type: "transfer_in",
        amount,
        balanceAfter: recipientUpdated.balance,
        counterparty: sender._id,
      },
    ]);

    await Notification.create({
      user: recipientUpdated._id,
      title: "💸 Money Received",
      body: `You received ${amount} ETB from ${
        sender.firstName || sender.username || "a user"
      }.`,
      type: "success",
    }).catch(() => {});

    res.json({ balance: sender.balance });
  } catch (err) {
    console.error("[wallet/transfer]", err);
    res.status(500).json({ error: "Could not process transfer" });
  }
});

module.exports = router;