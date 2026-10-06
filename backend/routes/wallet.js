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
    const amount = Number(req.body.amount);
    if (!amount || amount < MIN_DEPOSIT) {
      return res
        .status(400)
        .json({ error: `Minimum deposit is ${MIN_DEPOSIT} ETB` });
    }
    const reference = `DEP-${Date.now()}-${Math.floor(Math.random() * 999)}`;
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
    const amount = Number(req.body.amount);
    const { phone, method } = req.body;
    if (!amount || amount < MIN_WITHDRAW) {
      return res
        .status(400)
        .json({ error: `Minimum withdrawal is ${MIN_WITHDRAW} ETB` });
    }
    if (!phone) return res.status(400).json({ error: "Phone required" });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.balance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    user.balance -= amount;
    await user.save();

    await Transaction.create({
      user: user._id,
      type: "withdrawal",
      amount,
      balanceAfter: user.balance,
      status: "pending",
      meta: { phone, method: method || "telebirr" },
    });
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Could not process withdrawal" });
  }
});

router.post("/transfer", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const { toTelegramId } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    if (!toTelegramId) {
      return res.status(400).json({ error: "Recipient required" });
    }

    const sender = await User.findById(req.userId);
    const recipient = await User.findOne({ telegramId: String(toTelegramId) });
    if (!recipient) return res.status(404).json({ error: "Recipient not found" });
    if (sender.telegramId === recipient.telegramId) {
      return res.status(400).json({ error: "Cannot transfer to yourself" });
    }
    if (sender.balance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    sender.balance -= amount;
    recipient.balance += amount;
    await Promise.all([sender.save(), recipient.save()]);

    await Transaction.create([
      {
        user: sender._id,
        type: "transfer_out",
        amount,
        balanceAfter: sender.balance,
        counterparty: recipient._id,
      },
      {
        user: recipient._id,
        type: "transfer_in",
        amount,
        balanceAfter: recipient.balance,
        counterparty: sender._id,
      },
    ]);

    await Notification.create({
      user: recipient._id,
      title: "💸 Money Received",
      body: `You received ${amount} ETB from ${
        sender.firstName || sender.username || "a user"
      }.`,
      type: "success",
    });

    res.json({ balance: sender.balance });
  } catch (err) {
    res.status(500).json({ error: "Could not process transfer" });
  }
});

module.exports = router;