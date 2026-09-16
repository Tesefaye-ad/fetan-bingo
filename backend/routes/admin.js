const express = require("express");
const User = require("../models/User");
const Game = require("../models/Game");
const { requireAuth } = require("../middleware/auth");
const { getActiveUserCount } = require("../socket/gameSocket");

const router = express.Router();
router.use(requireAuth);

async function requireAdmin(req, res, next) {
  const user = await User.findById(req.userId).select("isAdmin");
  if (!user || !user.isAdmin) return res.status(403).json({ error: "Admin access required" });
  next();
}

router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const registeredUsers = await User.countDocuments();
    const totalGames = await Game.countDocuments({ status: "finished" });
    res.json({
      activeUsers: getActiveUserCount(),
      registeredUsers,
      totalGames,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load admin stats" });
  }
});

module.exports = router;