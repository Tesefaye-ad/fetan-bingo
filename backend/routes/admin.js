const express = require("express");
const User = require("../models/User");
const Game = require("../models/Game");
const Transaction = require("../models/Transaction");
const { Notification } = require("../models/User");
const auth = require("./auth");
const { requireAuth } = auth;
const { getActiveUserCount } = require("../socket/gameSocket");

const router = express.Router();
router.use(requireAuth);

async function requireAdmin(req, res, next) {
  const user = await User.findById(req.userId).select("isAdmin");
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const [registeredUsers, totalGames, pendingDeposits, pendingWithdrawals] =
      await Promise.all([
        User.countDocuments(),
        Game.countDocuments({ status: "finished" }),
        Transaction.countDocuments({ type: "deposit", status: "pending" }),
        Transaction.countDocuments({ type: "withdrawal", status: "pending" }),
      ]);
    res.json({
      activeUsers: getActiveUserCount(),
      registeredUsers,
      totalGames,
      pendingDeposits,
      pendingWithdrawals,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load stats" });
  }
});

router.get("/transactions", requireAdmin, async (req, res) => {
  try {
    const { type, status, limit = 50, skip = 0 } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate("user", "telegramId username firstName lastName phone")
        .sort({ createdAt: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .lean(),
      Transaction.countDocuments(filter),
    ]);
    res.json({ transactions, total });
  } catch (err) {
    res.status(500).json({ error: "Could not load transactions" });
  }
});

router.post("/transactions/:id/approve", requireAdmin, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: "Not found" });
    if (tx.status !== "pending") {
      return res.status(400).json({ error: "Already processed" });
    }

    const user = await User.findById(tx.user);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (tx.type === "deposit") {
      user.balance += tx.amount;
      user.totalDeposits = (user.totalDeposits || 0) + tx.amount;
      tx.balanceAfter = user.balance;
    } else if (tx.type === "withdrawal") {
      user.totalWithdrawals = (user.totalWithdrawals || 0) + tx.amount;
    }

    tx.status = "completed";
    await Promise.all([user.save(), tx.save()]);

    await Notification.create({
      user: user._id,
      title:
        tx.type === "deposit"
          ? "✅ Deposit Approved"
          : "✅ Withdrawal Approved",
      body:
        tx.type === "deposit"
          ? `Your deposit of ${tx.amount} ETB has been added.`
          : `Your withdrawal of ${tx.amount} ETB has been processed.`,
      type: tx.type === "deposit" ? "deposit" : "withdraw",
    });

    res.json({ ok: true, transaction: tx });
  } catch (err) {
    res.status(500).json({ error: "Could not approve" });
  }
});

router.post("/transactions/:id/reject", requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: "Not found" });
    if (tx.status !== "pending") {
      return res.status(400).json({ error: "Already processed" });
    }

    const user = await User.findById(tx.user);
    if (tx.type === "withdrawal" && user) {
      user.balance += tx.amount;
      tx.balanceAfter = user.balance;
      await user.save();
    }
    tx.status = "failed";
    tx.meta = { ...(tx.meta || {}), rejectReason: reason || "Rejected" };
    await tx.save();

    if (user) {
      await Notification.create({
        user: user._id,
        title:
          tx.type === "deposit"
            ? "❌ Deposit Rejected"
            : "❌ Withdrawal Rejected",
        body: reason || `Your ${tx.type} of ${tx.amount} ETB was rejected.`,
        type: "warning",
      });
    }
    res.json({ ok: true, transaction: tx });
  } catch (err) {
    res.status(500).json({ error: "Could not reject" });
  }
});

router.get("/users", requireAdmin, async (req, res) => {
  try {
    const { q, limit = 50, skip = 0 } = req.query;
    const filter = {};
    if (q) {
      filter.$or = [
        { telegramId: { $regex: q, $options: "i" } },
        { username: { $regex: q, $options: "i" } },
        { firstName: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
      ];
    }
    const [users, total] = await Promise.all([
      User.find(filter)
        .select(
          "telegramId username firstName lastName phone balance bonusBalance isBanned isAdmin gamesPlayed gamesWon totalWinnings referralCount createdAt"
        )
        .sort({ createdAt: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .lean(),
      User.countDocuments(filter),
    ]);
    res.json({ users, total });
  } catch (err) {
    res.status(500).json({ error: "Could not load users" });
  }
});

router.post("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const { banned } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: !!banned },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: "Could not update user" });
  }
});

router.post("/broadcast", requireAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: "Title and body required" });
    }
    const notification = await Notification.create({
      user: null,
      title,
      body,
      type: "info",
    });
    res.json({ ok: true, notification });
  } catch (err) {
    res.status(500).json({ error: "Could not broadcast" });
  }
});

router.post("/users/:id/balance", requireAdmin, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = Number(amount);
    if (!amt) return res.status(400).json({ error: "Invalid amount" });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.balance += amt;
    await user.save();

    await Transaction.create({
      user: user._id,
      type: amt > 0 ? "deposit" : "withdrawal",
      amount: Math.abs(amt),
      balanceAfter: user.balance,
      reference: "ADMIN_ADJUST",
      status: "completed",
      meta: { note: note || "Admin adjustment" },
    });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: "Could not adjust balance" });
  }
});

module.exports = router;