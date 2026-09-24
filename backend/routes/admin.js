const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Game = require("../models/Game");
const Transaction = require("../models/Transaction");
const { Notification } = require("../models/User");
const auth = require("./auth");
const { requireAuth } = auth;
const { getActiveUserCount } = require("../socket/gameSocket");

const router = express.Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════
// 👈 CONFIG MODEL (inline — አዲስ ፋይል ሳይፈጠር)
// ═══════════════════════════════════════════════════════
const ConfigSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "system" },
    ticketPrice: { type: Number, default: 10 },
    winnerPercent: { type: Number, default: 80 },
    forcedWinNumber: { type: Number, default: null },
    drawMode: {
      type: String,
      enum: ["random", "manual", "forced"],
      default: "random",
    },
  },
  { timestamps: true }
);

const Config = mongoose.model("Config", ConfigSchema);

async function getConfig() {
  let config = await Config.findOne({ key: "system" });
  if (!config) config = await Config.create({ key: "system" });
  return config;
}

// ═══════════════════════════════════════════════════════
// ADMIN GUARD
// ═══════════════════════════════════════════════════════
async function requireAdmin(req, res, next) {
  const user = await User.findById(req.userId).select("isAdmin");
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// ═══════════════════════════════════════════════════════
// STATS — Financial Dashboard
// ═══════════════════════════════════════════════════════
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const [
      registeredUsers,
      totalGames,
      pendingDeposits,
      pendingWithdrawals,
      approvedDepositsAgg,
      approvedWithdrawalsAgg,
    ] = await Promise.all([
      User.countDocuments(),
      Game.countDocuments({ status: "finished" }),
      Transaction.countDocuments({ type: "deposit", status: "pending" }),
      Transaction.countDocuments({ type: "withdrawal", status: "pending" }),
      Transaction.aggregate([
        { $match: { type: "deposit", status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.aggregate([
        { $match: { type: "withdrawal", status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const totalDeposits = approvedDepositsAgg[0]?.total || 0;
    const totalWithdrawals = approvedWithdrawalsAgg[0]?.total || 0;
    const houseCommission = totalDeposits - totalWithdrawals;

    res.json({
      activeUsers: getActiveUserCount(),
      registeredUsers,
      totalGames,
      pendingDeposits,
      pendingWithdrawals,
      totalDeposits,
      totalWithdrawals,
      houseCommission,
    });
  } catch (err) {
    console.error("[admin/stats]", err);
    res.status(500).json({ error: "Could not load stats" });
  }
});

// ═══════════════════════════════════════════════════════
// TRANSACTIONS — list with filters
// ═══════════════════════════════════════════════════════
router.get("/transactions", requireAdmin, async (req, res) => {
  try {
    const { type, status, limit = 100, skip = 0 } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;

    const [transactions, total, counts] = await Promise.all([
      Transaction.find(filter)
        .populate("user", "telegramId username firstName lastName phone")
        .sort({ createdAt: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .lean(),
      Transaction.countDocuments(filter),
      Transaction.aggregate([
        {
          $match: {
            type: type || { $in: ["deposit", "withdrawal"] },
          },
        },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts = { pending: 0, completed: 0, failed: 0, all: 0 };
    for (const c of counts) {
      statusCounts[c._id] = c.count;
      statusCounts.all += c.count;
    }

    res.json({ transactions, total, statusCounts });
  } catch (err) {
    console.error("[admin/transactions]", err);
    res.status(500).json({ error: "Could not load transactions" });
  }
});

// ═══════════════════════════════════════════════════════
// APPROVE
// ═══════════════════════════════════════════════════════
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
    console.error("[admin/approve]", err);
    res.status(500).json({ error: "Could not approve" });
  }
});

// ═══════════════════════════════════════════════════════
// REJECT
// ═══════════════════════════════════════════════════════
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
    console.error("[admin/reject]", err);
    res.status(500).json({ error: "Could not reject" });
  }
});

// ═══════════════════════════════════════════════════════
// USERS — list + search
// ═══════════════════════════════════════════════════════
router.get("/users", requireAdmin, async (req, res) => {
  try {
    const { q, limit = 100, skip = 0 } = req.query;
    const filter = {};
    if (q) {
      filter.$or = [
        { telegramId: { $regex: q, $options: "i" } },
        { username: { $regex: q, $options: "i" } },
        { firstName: { $regex: q, $options: "i" } },
        { lastName: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(
          "telegramId username firstName lastName phone balance bonusBalance isBanned isAdmin gamesPlayed gamesWon totalWinnings createdAt"
        )
        .sort({ createdAt: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({ users, total });
  } catch (err) {
    console.error("[admin/users]", err);
    res.status(500).json({ error: "Could not load users" });
  }
});

// ═══════════════════════════════════════════════════════
// BAN / UNBAN
// ═══════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════
// ADJUST BALANCE / EDIT USER
// ═══════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════
// BROADCAST
// ═══════════════════════════════════════════════════════
router.post("/broadcast", requireAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ error: "Message required" });
    }
    const notification = await Notification.create({
      user: null,
      title: title || "📢 Announcement",
      body,
      type: "info",
    });
    res.json({ ok: true, notification });
  } catch (err) {
    res.status(500).json({ error: "Could not broadcast" });
  }
});

// ═══════════════════════════════════════════════════════
// CONFIG — GET / UPDATE
// ═══════════════════════════════════════════════════════
router.get("/config", requireAdmin, async (req, res) => {
  try {
    const config = await getConfig();
    res.json({
      ticketPrice: config.ticketPrice,
      winnerPercent: config.winnerPercent,
      forcedWinNumber: config.forcedWinNumber,
      drawMode: config.drawMode,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load config" });
  }
});

router.post("/config", requireAdmin, async (req, res) => {
  try {
    const { ticketPrice, winnerPercent } = req.body;
    const config = await getConfig();

    if (ticketPrice !== undefined) {
      const tp = Number(ticketPrice);
      if (tp > 0) config.ticketPrice = tp;
    }
    if (winnerPercent !== undefined) {
      const wp = Number(winnerPercent);
      if (wp > 0 && wp <= 100) config.winnerPercent = wp;
    }
    await config.save();

    res.json({
      ok: true,
      config: {
        ticketPrice: config.ticketPrice,
        winnerPercent: config.winnerPercent,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Could not save config" });
  }
});

// ═══════════════════════════════════════════════════════
// DRAW — set forced win number
// ═══════════════════════════════════════════════════════
router.post("/draw/set", requireAdmin, async (req, res) => {
  try {
    const { number } = req.body;
    const num = Number(number);
    if (!num || num < 1 || num > 1250) {
      return res.status(400).json({ error: "Enter 1-1250" });
    }
    const config = await getConfig();
    config.forcedWinNumber = num;
    config.drawMode = "forced";
    await config.save();
    res.json({ ok: true, forcedWinNumber: num });
  } catch (err) {
    res.status(500).json({ error: "Could not set" });
  }
});

router.post("/draw/clear", requireAdmin, async (req, res) => {
  try {
    const config = await getConfig();
    config.forcedWinNumber = null;
    config.drawMode = "random";
    await config.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Could not clear" });
  }
});

module.exports = router;