const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const { requireAuth } = require("./auth");
const rooms = require("../services/rooms");

const router = express.Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════
// የክፍሉ ሁኔታ — ሰዓቱን ፈጽሞ አይቀይርም (ሁሉም ተጠቃሚ አንድ ዓይነት absolute ሰዓት ያገኛል).
// ሰዓቱን የሚያስተዳድረው የ socket ሞተር ብቻ ነው.
// ═══════════════════════════════════════════════════════
async function sendRoom(req, res, status = 200) {
  try {
    const roomCode = rooms.normalizeRoomCode(req.params.roomCode || req.body?.roomCode);
    if (!roomCode) return res.status(404).json({ error: "Unknown room" });

    const game = await rooms.ensureRoom(roomCode);
    const state = rooms.publicState(game);
    res.set("Cache-Control", "no-store");
    res.status(status).json({
      ...state,
      remainingSeconds: Math.ceil(state.remainingMs / 1000),
      winnersCount: game.winners?.length || 0,
    });
  } catch (err) {
    console.error("[game route]", err);
    res.status(500).json({ error: "Could not load room" });
  }
}

router.get("/rooms/:roomCode", (req, res) => sendRoom(req, res, 200));
router.post("/rooms", (req, res) => sendRoom(req, res, 201));

router.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalGames = await Game.countDocuments({ status: "finished" });
    res.json({ totalUsers, totalGames });
  } catch (err) {
    res.status(500).json({ error: "Could not load stats" });
  }
});

module.exports = router;
