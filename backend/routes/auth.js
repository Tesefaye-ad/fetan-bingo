const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { verifyTelegramInitData } = require("../utils/telegramVerify");

const router = express.Router();

router.post("/telegram", async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ error: "initData is required" });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return res.status(500).json({ error: "Bot token not configured" });

    const { valid, data } = verifyTelegramInitData(initData, botToken);
    if (!valid || !data?.user) {
      return res.status(401).json({ error: "Invalid Telegram authentication data" });
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
      await user.save();
    }

    if (user.isBanned) {
      return res.status(403).json({ error: "This account has been suspended" });
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
        bonusBalance: user.bonusBalance,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
        referralCount: user.referralCount,
        isAdmin: user.isAdmin,
      },
    });
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

module.exports = router;