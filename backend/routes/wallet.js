const express = require("express");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

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
      .limit(50);
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: "Could not load transaction history" });
  }
});

router.post("/deposit/initiate", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    const reference = `SIM-${Date.now()}`;
    return res.json({
      message: "Payment gateway not yet configured.",
      reference,
      amount,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not start deposit" });
  }
});

router.post("/deposit/confirm", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const { reference } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.balance += amount;
    await user.save();

    await Transaction.create({
      user: user._id,
      type: "deposit",
      amount,
      balanceAfter: user.balance,
      reference,
      status: "completed",
    });

    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Could not confirm deposit" });
  }
});

router.post("/withdraw", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.balance < amount) return res.status(400).json({ error: "Insufficient balance" });

    user.balance -= amount;
    await user.save();

    await Transaction.create({
      user: user._id,
      type: "withdrawal",
      amount,
      balanceAfter: user.balance,
      status: "pending",
    });

    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Could not process withdrawal" });
  }
});

// Transfer to another user
router.post("/transfer", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const { toTelegramId } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    if (!toTelegramId) return res.status(400).json({ error: "Recipient is required" });

    const sender = await User.findById(req.userId);
    const recipient = await User.findOne({ telegramId: String(toTelegramId) });

    if (!recipient) return res.status(404).json({ error: "Recipient not found" });
    if (sender.telegramId === recipient.telegramId) {
      return res.status(400).json({ error: "Cannot transfer to yourself" });
    }
    if (sender.balance < amount) return res.status(400).json({ error: "Insufficient balance" });

    sender.balance -= amount;
    recipient.balance += amount;
    await sender.save();
    await recipient.save();

    await Transaction.create({
      user: sender._id,
      type: "transfer_out",
      amount,
      balanceAfter: sender.balance,
      counterparty: recipient._id,
    });
    await Transaction.create({
      user: recipient._id,
      type: "transfer_in",
      amount,
      balanceAfter: recipient.balance,
      counterparty: sender._id,
    });

    res.json({ balance: sender.balance });
  } catch (err) {
    res.status(500).json({ error: "Could not process transfer" });
  }
});

module.exports = router;