const express = require("express");
const User = require("../models/User");
const Game = require("../models/Game");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════
// GET /me — current user full profile
// ═══════════════════════════════════════════════════════
router.get("/me", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-__v").lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: "Could not load profile" });
  }
});

// ═══════════════════════════════════════════════════════
// GET /leaderboard — top players
// ═══════════════════════════════════════════════════════
router.get("/leaderboard", async (req, res) => {
  try {
    const byWinnings = await User.find({ totalWinnings: { $gt: 0 } })
      .select("username firstName lastName totalWinnings gamesWon photoUrl")
      .sort({ totalWinnings: -1 })
      .limit(20)
      .lean();

    const byGames = await User.find({ gamesWon: { $gt: 0 } })
      .select("username firstName lastName totalWinnings gamesWon photoUrl")
      .sort({ gamesWon: -1 })
      .limit(20)
      .lean();

    res.json({ byWinnings, byGames });
  } catch (err) {
    res.status(500).json({ error: "Could not load leaderboard" });
  }
});

// ═══════════════════════════════════════════════════════
// GET /referral — referral info + list
// ═══════════════════════════════════════════════════════
router.get("/referral", async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const invited = await User.find({ referredBy: user.telegramId })
      .select("username firstName lastName createdAt gamesPlayed")
      .sort({ createdAt: -1 })
      .lean();

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || "fetanbingo1_bot";
    const link = `https://t.me/${botUsername.replace("@", "")}?start=ref_${user.telegramId}`;

    res.json({
      link,
      referralCount: user.referralCount || 0,
      invited: invited.map((u) => ({
        name: u.firstName || u.username || "Player",
        joinedAt: u.createdAt,
        gamesPlayed: u.gamesPlayed || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load referral" });
  }
});

// ═══════════════════════════════════════════════════════
// GET /achievements — user achievements
// ═══════════════════════════════════════════════════════
router.get("/achievements", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("achievements");
    res.json({ achievements: user?.achievements || [] });
  } catch (err) {
    res.status(500).json({ error: "Could not load achievements" });
  }
});

// ═══════════════════════════════════════════════════════
// GET /games/history — user's game history
// ═══════════════════════════════════════════════════════
router.get("/games/history", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const userId = req.userId;

    const games = await Game.find({
      "players.user": userId,
      status: "finished",
    })
      .select("roomCode entryFee prizePool winners winningCartelas finishedAt createdAt")
      .sort({ finishedAt: -1 })
      .limit(limit)
      .lean();

    const history = games.map((g) => {
      const won = (g.winners || []).some((w) => w.toString() === userId.toString());
      const myCard = (g.winningCartelas || []).find(
        (wc) => wc.userId === userId.toString() || wc.telegramId === String(req.telegramId)
      );
      return {
        roomCode: g.roomCode,
        entryFee: g.entryFee,
        prizePool: g.prizePool,
        won,
        pattern: myCard?.pattern || null,
        cardId: myCard?.cardId || null,
        finishedAt: g.finishedAt,
      };
    });

    res.json({ history });
  } catch (err) {
    console.error("[games/history]", err);
    res.status(500).json({ error: "Could not load history" });
  }
});

// ═══════════════════════════════════════════════════════
// GET /notifications — user notifications
// ═══════════════════════════════════════════════════════
router.get("/notifications", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const user = await User.findById(req.userId).select("createdAt");

    // User-specific + broadcasts (created after user signup)
    const notifications = await Notification.find({
      $or: [
        { user: req.userId },
        { user: null, createdAt: { $gte: user.createdAt } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const unreadCount = notifications.filter((n) => !n.isRead && n.user).length;

    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: "Could not load notifications" });
  }
});

router.post("/notifications/read", async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.userId, isRead: false },
      { isRead: true }
    );
    await User.findByIdAndUpdate(req.userId, {
      notificationReadAt: new Date(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Could not mark read" });
  }
});

module.exports = router;