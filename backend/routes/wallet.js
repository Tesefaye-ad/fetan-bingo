const express = require("express");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/wallet/balance
router.get("/balance", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("balance");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ balance: user.balance });
  } catch (err) {
    console.error("[GET /api/wallet/balance] error:", err);
    res.status(500).json({ error: "Could not load balance" });
  }
});

// GET /api/wallet/history
router.get("/history", async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ transactions });
  } catch (err) {
    console.error("[GET /api/wallet/history] error:", err);
    res.status(500).json({ error: "Could not load transaction history" });
  }
});

/**
 * POST /api/wallet/deposit/initiate
 * Body: { amount: number }
 *
 * This is where you'd call the Telebirr (or other PSP) API to create a
 * payment session and return a checkout URL / reference to the client.
 * Wired here as a clearly-marked integration point since it requires your
 * own merchant credentials (TELEBIRR_APP_ID / APP_KEY / SHORT_CODE in .env).
 */
router.post("/deposit/initiate", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // TODO: replace with a real call to your payment provider's API, e.g.:
    // const session = await telebirrClient.createOrder({ amount, ... });
    // return res.json({ checkoutUrl: session.url, reference: session.outTradeNo });

    const fakeReference = `SIM-${Date.now()}`;
    return res.json({
      message:
        "Payment gateway not yet configured. Wire this endpoint to your PSP (e.g. Telebirr) before going live.",
      reference: fakeReference,
      amount,
    });
  } catch (err) {
    console.error("[POST /api/wallet/deposit/initiate] error:", err);
    res.status(500).json({ error: "Could not start deposit" });
  }
});

/**
 * POST /api/wallet/deposit/confirm
 * Body: { reference: string, amount: number }
 *
 * IMPORTANT: In production this must be a server-to-server WEBHOOK from
 * your payment provider (never trust a client-supplied "it succeeded"
 * call for real money). This route exists so the demo flow is runnable
 * end to end - swap it for a verified webhook handler before accepting
 * real funds.
 */
router.post("/deposit/confirm", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const { reference } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

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
    console.error("[POST /api/wallet/deposit/confirm] error:", err);
    res.status(500).json({ error: "Could not confirm deposit" });
  }
});

// POST /api/wallet/withdraw  { amount }
router.post("/withdraw", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

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
      status: "pending", // mark completed once payout via PSP actually clears
    });

    res.json({ balance: user.balance });
  } catch (err) {
    console.error("[POST /api/wallet/withdraw] error:", err);
    res.status(500).json({ error: "Could not process withdrawal" });
  }
});

module.exports = router;
