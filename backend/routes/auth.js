const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { verifyTelegramInitData } = require("../utils/telegramVerify");

const router = express.Router();

/**
 * POST /api/auth/telegram
 * Body: { initData: "<raw initData string from Telegram.WebApp.initData>" }
 */
router.post("/telegram", async (req, res) => {
  try {
    const { initData } = req.body;

    if (!initData) {
      console.warn("[POST /api/auth/telegram] initData is missing from request body.");
      return res.status(400).json({ error: "initData is required" });
    }

    // 🔍 የቦት ቶከን መኖሩን ማረጋገጥ
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.error("[POST /api/auth/telegram] TELEGRAM_BOT_TOKEN is missing in environment variables!");
      return res.status(500).json({ error: "Server configuration error: Bot token missing" });
    }

    const { valid, data } = verifyTelegramInitData(
      initData,
      process.env.TELEGRAM_BOT_TOKEN
    );

    if (!valid || !data?.user) {
      console.error("[POST /api/auth/telegram] Verification failed. initData may be expired (>24h) or token mismatch.");
      return res.status(401).json({ error: "Invalid Telegram authentication (Token mismatch or expired)" });
    }

    const { id, username, first_name, last_name, photo_url } = data.user;

    let user = await User.findOne({ telegramId: String(id) });
    if (!user) {
      user = await User.create({
        telegramId: String(id),
        username,
        firstName: first_name,
        lastName: last_name,
        photoUrl: photo_url,
        balance: 0,
      });
    } else {
      // keep profile fields fresh
      user.username = username;
      user.firstName = first_name;
      user.lastName = last_name;
      user.photoUrl = photo_url;
      await user.save();
    }

    if (user.isBanned) {
      return res.status(403).json({ error: "This account has been suspended" });
    }

    if (!process.env.JWT_SECRET) {
      console.error("[POST /api/auth/telegram] JWT_SECRET is missing in environment variables!");
      return res.status(500).json({ error: "Server configuration error: JWT secret missing" });
    }

    const token = jwt.sign(
      { userId: user._id.toString(), telegramId: user.telegramId },
      process.env.JWT_SECRET,
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
        isAdmin: user.isAdmin,
      },
    });
  } catch (err) {
    console.error("[POST /api/auth/telegram] unexpected error:", err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

module.exports = router;