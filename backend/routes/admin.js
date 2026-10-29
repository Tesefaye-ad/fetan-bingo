const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Game = require("../models/Game");
const Transaction = require("../models/Transaction");
const { Notification } = require("../models/User");

const auth = require("./auth");
const { requireAuth, clearBanCache } = auth;

const { getActiveUserCount, setForcedWinner } = require("../socket/gameSocket");
const {
  approveTransaction,
  rejectTransaction,
} = require("../services/deposits");

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clampInt = (v, def, min, max) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const NON_CASH_REF = /^(ADMIN_ADJUST|BONUS-)/;

const router = express.Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════
// ADMIN TELEGRAM IDs — no fallback
// ═══════════════════════════════════════════════════════
const ADMIN_TELEGRAM_IDS = String(process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (ADMIN_TELEGRAM_IDS.length === 0) {
  throw new Error("[admin] ADMIN_TELEGRAM_IDS is required");
}
console.log("[admin] Env admin IDs:", ADMIN_TELEGRAM_IDS);

// ═══════════════════════════════════════════════════════
// CONFIG MODEL
// ═══════════════════════════════════════════════════════
const ConfigSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "system" },
    ticketPrice: { type: Number, default: 10 },
    winnerPercent: { type: Number, default: 80 },
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
  try {
    const user = await User.findById(req.userId).select("isAdmin telegramId");
    if (!user) {
      return res.status(403).json({ error: "Admin access required" });
    }

    if (ADMIN_TELEGRAM_IDS.includes(String(user.telegramId))) {
      if (!user.isAdmin) {
        User.updateOne(
          { _id: user._id },
          { $set: { isAdmin: true } }
        ).catch((e) =>
          console.warn("[admin] isAdmin sync failed:", e.message)
        );
        console.log(
          `[admin] ✅ Auto-sync ${user.telegramId} → isAdmin=true`
        );
      }
      return next();
    }

    if (!user.isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch (err) {
    console.error("[admin/requireAdmin]", err);
    return res.status(500).json({ error: "Admin check failed" });
  }
}

// ═══════════════════════════════════════════════════════
// STATS
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
      entryFeesAgg,
      prizesAgg,
    ] = await Promise.all([
      User.countDocuments(),
      Game.countDocuments({ status: "finished" }),
      Transaction.countDocuments({ type: "deposit", status: "pending" }),
      Transaction.countDocuments({ type: "withdrawal", status: "pending" }),
      Transaction.aggregate([
        {
          $match: {
            type: "deposit",
            status: "completed",
            reference: { $not: NON_CASH_REF },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.aggregate([
        {
          $match: {
            type: "withdrawal",
            status: "completed",
            reference: { $not: NON_CASH_REF },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.aggregate([
        { $match: { type: "entry_fee", status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.aggregate([
        { $match: { type: "prize", status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const totalDeposits = approvedDepositsAgg[0]?.total || 0;
    const totalWithdrawals = approvedWithdrawalsAgg[0]?.total || 0;
    const totalEntryFees = entryFeesAgg[0]?.total || 0;
    const totalPrizes = prizesAgg[0]?.total || 0;

    res.json({
      activeUsers: getActiveUserCount(),
      registeredUsers,
      totalGames,
      pendingDeposits,
      pendingWithdrawals,
      totalDeposits,
      totalWithdrawals,
      netCashFlow: totalDeposits - totalWithdrawals,
      totalEntryFees,
      totalPrizes,
      houseCommission: totalEntryFees - totalPrizes,
    });
  } catch (err) {
    console.error("[admin/stats]", err);
    res.status(500).json({ error: "Could not load stats" });
  }
});

router.get("/transactions", requireAdmin, async (req, res) => {
  try {
    const { type, status } = req.query;
    const limit = clampInt(req.query.limit, 100, 1, 200);
    const skip = clampInt(req.query.skip, 0, 0, 1e6);
    const filter = {};
    if (type) filter.type = String(type);
    if (status) filter.status = String(status);

    const [transactions, total, counts] = await Promise.all([
      Transaction.find(filter)
        .populate("user", "telegramId username firstName lastName phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter),
      Transaction.aggregate([
        {
          $match: {
            type: type ? String(type) : { $in: ["deposit", "withdrawal"] },
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

router.post("/transactions/:id/approve", requireAdmin, async (req, res) => {
  try {
    const r = await approveTransaction(req.params.id);
    if (!r.ok) return res.status(r.code || 400).json({ error: r.error });
    res.json({ ok: true, transaction: r.transaction });
  } catch (err) {
    console.error("[admin/approve]", err);
    res.status(500).json({ error: "Could not approve" });
  }
});

router.post("/transactions/:id/reject", requireAdmin, async (req, res) => {
  try {
    const reason =
      typeof req.body?.reason === "string"
        ? req.body.reason.slice(0, 300)
        : undefined;
    const r = await rejectTransaction(req.params.id, reason);
    if (!r.ok) return res.status(r.code || 400).json({ error: r.error });
    res.json({ ok: true, transaction: r.transaction });
  } catch (err) {
    console.error("[admin/reject]", err);
    res.status(500).json({ error: "Could not reject" });
  }
});

router.get("/users", requireAdmin, async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 64) : "";
    const limit = clampInt(req.query.limit, 100, 1, 200);
    const skip = clampInt(req.query.skip, 0, 0, 1e6);
    const filter = {};
    if (q) {
      const rx = escapeRegex(q);
      filter.$or = [
        { telegramId: { $regex: rx, $options: "i" } },
        { username: { $regex: rx, $options: "i" } },
        { firstName: { $regex: rx, $options: "i" } },
        { lastName: { $regex: rx, $options: "i" } },
        { phone: { $regex: rx, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(
          "telegramId username firstName lastName phone balance bonusBalance isBanned isAdmin gamesPlayed gamesWon totalWinnings createdAt"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({ users, total });
  } catch (err) {
    console.error("[admin/users]", err);
    res.status(500).json({ error: "Could not load users" });
  }
});

router.post("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const { banned } = req.body;
    if (String(req.params.id) === String(req.userId)) {
      return res.status(400).json({ error: "Cannot ban yourself" });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: !!banned },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: "User not found" });

    if (typeof clearBanCache === "function") {
      clearBanCache(user._id);
    }

    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: "Could not update user" });
  }
});

router.post("/users/:id/balance", requireAdmin, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = Number(amount);
    
    if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > 1e7) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const filter = { _id: req.params.id };
    if (amt < 0) {
      filter.balance = { $gte: -amt };
    }

    const user = await User.findOneAndUpdate(
      filter,
      { $inc: { balance: amt } },
      { new: true }
    );

    if (!user) {
      const exists = await User.exists({ _id: req.params.id });
      if (!exists) {
        return res.status(404).json({ error: "User not found" });
      }
      return res.status(400).json({ error: "Insufficient balance" });
    }

    await Transaction.create({
      user: user._id,
      type: amt > 0 ? "deposit" : "withdrawal",
      amount: Math.abs(amt),
      balanceAfter: user.balance,
      reference: "ADMIN_ADJUST",
      status: "completed",
      meta: {
        note: String(note || "Admin adjustment").slice(0, 300),
        by: req.userId,
      },
    });

    res.json({ ok: true, user });
  } catch (err) {
    console.error("[admin/balance]", err);
    res.status(500).json({ error: "Could not adjust balance" });
  }
});

router.post("/broadcast", requireAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "Message required" });
    }
    const notification = await Notification.create({
      user: null,
      title:
        typeof title === "string" && title.trim()
          ? title.slice(0, 120)
          : "📢 Announcement",
      body: body.slice(0, 2000),
      type: "info",
    });
    res.json({ ok: true, notification });
  } catch (err) {
    res.status(500).json({ error: "Could not broadcast" });
  }
});

router.get("/config", requireAdmin, async (req, res) => {
  try {
    const config = await getConfig();
    res.json({
      ticketPrice: config.ticketPrice,
      winnerPercent: config.winnerPercent,
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

// ✅ የተስተካከለው Force Win API (Redis ላይ ስለሚጽፍ await ተጨምሯል)
router.post("/force-win", requireAdmin, async (req, res) => {
  try {
    const { roomCode, cardId } = req.body;
    if (!roomCode) {
      return res.status(400).json({ error: "Room code is required" });
    }
    
    await setForcedWinner(roomCode, cardId ? Number(cardId) : null);
    
    res.json({
      ok: true,
      message: cardId
        ? `ካርቴላ #${cardId} እንዲያሸንፍ ተደርጓል`
        : "የተገደደ አሸናፊ ተሰርዟል",
    });
  } catch (err) {
    console.error("[admin/force-win]", err);
    res.status(500).json({ error: "Could not set forced winner" });
  }
});

module.exports = router;