const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const Game = require("../models/Game");
const Transaction = require("../models/Transaction");
const { Notification } = require("../models/User");

const router = express.Router();
const userRouter = express.Router();

// ═══════════════════════════════════════════════════════
// JWT HELPERS (ከ middleware/auth.js የተዋሃደ)
// ═══════════════════════════════════════════════════════
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("[auth] JWT_SECRET missing or too short.");
  }
  return secret;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.userId = payload.userId;
    req.telegramId = payload.telegramId;
    next();
  } catch (err) {
    if (err.message?.includes("JWT_SECRET")) {
      return res.status(500).json({ error: "Server auth misconfigured" });
    }
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function verifySocketToken(token) {
  try {
    if (!token) return null;
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// TELEGRAM VERIFY (ከ utils/telegramVerify.js የተዋሃደ)
// ═══════════════════════════════════════════════════════
function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  try {
    if (!initData || !botToken) return { valid: false, data: null };
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return { valid: false, data: null };
    urlParams.delete("hash");

    const dataCheckArr = [];
    for (const [key, value] of [...urlParams.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      dataCheckArr.push(`${key}=${value}`);
    }
    const dataCheckString = dataCheckArr.join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();
    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const valid =
      computedHash.length === hash.length &&
      crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash));
    if (!valid) return { valid: false, data: null };

    const authDate = Number(urlParams.get("auth_date") || 0);
    if (authDate && Date.now() / 1000 - authDate > maxAgeSeconds) {
      return { valid: false, data: null };
    }

    const userRaw = urlParams.get("user");
    return {
      valid: true,
      data: { user: userRaw ? JSON.parse(userRaw) : null, auth_date: authDate },
    };
  } catch (err) {
    return { valid: false, data: null };
  }
}

// ═══════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════
router.post("/telegram", async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ error: "initData required" });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return res.status(500).json({ error: "Bot token missing" });

    const { valid, data } = verifyTelegramInitData(initData, botToken);
    if (!valid || !data?.user) {
      return res.status(401).json({ error: "Invalid Telegram auth" });
    }

    const { id, username, first_name, last_name, photo_url } = data.user;
    let user = await User.findOne({ telegramId: String(id) });

    if (!user) {
      user = await User.create({
        telegramId: String(id),
        username: username || `user_${id}`,
        firstName: first_name || "User",
        lastName: last_name || "",
        photoUrl: photo_url || "",
        balance: 0,
      });
    } else {
      user.username = username || user.username;
      user.firstName = first_name || user.firstName;
      user.lastName = last_name || user.lastName;
      user.photoUrl = photo_url || user.photoUrl;
      user.lastActiveAt = new Date();
      await user.save();
    }

    if (user.isBanned) {
      return res.status(403).json({ error: "Account suspended" });
    }

    const token = jwt.sign(
      { userId: user._id.toString(), telegramId: user.telegramId },
      getJwtSecret(),
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        photoUrl: user.photoUrl,
        balance: user.balance,
        bonusBalance: user.bonusBalance,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
        totalWinnings: user.totalWinnings,
        referralCount: user.referralCount,
        isAdmin: user.isAdmin,
      },
    });
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ═══════════════════════════════════════════════════════
// USER ROUTES (ከ routes/user.js የተዋሃደ)
// ═══════════════════════════════════════════════════════
userRouter.use(requireAuth);

userRouter.get("/me", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-__v").lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: "Could not load profile" });
  }
});

userRouter.get("/leaderboard", async (req, res) => {
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

userRouter.get("/referral", async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const invited = await User.find({ referredBy: user.telegramId })
      .select("username firstName lastName createdAt gamesPlayed")
      .sort({ createdAt: -1 })
      .lean();

    const botUsername =
      process.env.TELEGRAM_BOT_USERNAME || "fetanbingo1_bot";
    const link = `https://t.me/${botUsername.replace(
      "@",
      ""
    )}?start=ref_${user.telegramId}`;

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

userRouter.get("/achievements", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("achievements");
    res.json({ achievements: user?.achievements || [] });
  } catch (err) {
    res.status(500).json({ error: "Could not load achievements" });
  }
});

userRouter.get("/games/history", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const userId = req.userId;
    const games = await Game.find({
      "players.user": userId,
      status: "finished",
    })
      .select(
        "roomCode entryFee prizePool winners winningCartelas finishedAt createdAt"
      )
      .sort({ finishedAt: -1 })
      .limit(limit)
      .lean();

    const history = games.map((g) => {
      const won = (g.winners || []).some(
        (w) => w.toString() === userId.toString()
      );
      const myCard = (g.winningCartelas || []).find(
        (wc) =>
          wc.userId === userId.toString() ||
          wc.telegramId === String(req.telegramId)
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
    res.status(500).json({ error: "Could not load history" });
  }
});

userRouter.get("/notifications", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const user = await User.findById(req.userId).select("createdAt");
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

userRouter.post("/notifications/read", async (req, res) => {
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

// ═══════════════════════════════════════════════════════
// EXPORTS — auth + middleware + user router
// ═══════════════════════════════════════════════════════
module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.verifySocketToken = verifySocketToken;
module.exports.userRouter = userRouter;