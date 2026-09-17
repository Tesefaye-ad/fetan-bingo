const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// 👈 ነጠላ የሰዓት ተለዋዋጭ — 50 ሰከንድ
const TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);

// ═══════════════════════════════════════════════════════
// GET /api/game/rooms/:roomCode — የክፍል ሁኔታ
// ═══════════════════════════════════════════════════════
router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    const game = await Game.findOne({ roomCode }).select(
      "roomCode status entryFee prizePool players calledNumbers maxNumber winners reservedCards selectionEndsAt"
    );
    if (!game) return res.status(404).json({ error: "Room not found" });

    res.json({
      roomCode: game.roomCode,
      status: game.status,
      entryFee: game.entryFee,
      prizePool: game.prizePool,
      playerCount: game.players.length,
      calledNumbers: game.calledNumbers,
      maxNumber: game.maxNumber,
      takenCards: game.players.map((p) => p.cardId),
      reservedCards: (game.reservedCards || []).map((r) => r.cardId),
      selectionEndsAt: game.selectionEndsAt,
      winnersCount: game.winners?.length || 0,
    });
  } catch (err) {
    console.error("[GET /api/game/rooms/:roomCode] error:", err);
    res.status(500).json({ error: "Could not load room" });
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/game/stats — አጠቃላይ ስታቲስቲክስ
// ═══════════════════════════════════════════════════════
router.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalGames = await Game.countDocuments({ status: "finished" });
    res.json({ totalUsers, totalGames });
  } catch (err) {
    res.status(500).json({ error: "Could not load stats" });
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/game/rooms — ክፍት ክፍሎች ዝርዝር
// ═══════════════════════════════════════════════════════
router.get("/rooms", async (req, res) => {
  try {
    const rooms = await Game.find({ status: "waiting" })
      .sort({ createdAt: -1 })
      .limit(30)
      .select("roomCode status entryFee prizePool players maxNumber selectionEndsAt");

    res.json({
      rooms: rooms.map((g) => ({
        roomCode: g.roomCode,
        status: g.status,
        entryFee: g.entryFee,
        prizePool: g.prizePool,
        playerCount: g.players.length,
        maxNumber: g.maxNumber,
        selectionEndsAt: g.selectionEndsAt,
      })),
    });
  } catch (err) {
    console.error("[GET /api/game/rooms] error:", err);
    res.status(500).json({ error: "Could not load rooms" });
  }
});

// ═══════════════════════════════════════════════════════
// POST /api/game/rooms — አዲስ ክፍል ፍጠር
// ═══════════════════════════════════════════════════════
router.post("/rooms", async (req, res) => {
  try {
    let { roomCode, entryFee } = req.body;
    roomCode = (roomCode || generateRoomCode()).trim().toUpperCase();
    entryFee = Number(entryFee ?? process.env.ENTRY_FEE ?? 10);

    let game = await Game.findOne({ roomCode });
    if (!game) {
      game = await Game.create({
        roomCode,
        entryFee,
        maxNumber: Number(process.env.BINGO_MAX_NUMBER || 75),
        selectionEndsAt: new Date(Date.now() + TIMER_MS), // 👈 50s
      });
    } else if (
      game.status === "waiting" &&
      (!game.selectionEndsAt || game.selectionEndsAt < new Date())
    ) {
      game.selectionEndsAt = new Date(Date.now() + TIMER_MS); // 👈 50s
      await game.save();
    }

    res.status(201).json({
      roomCode: game.roomCode,
      status: game.status,
      entryFee: game.entryFee,
      prizePool: game.prizePool,
      playerCount: game.players.length,
      selectionEndsAt: game.selectionEndsAt,
    });
  } catch (err) {
    console.error("[POST /api/game/rooms] error:", err);
    res.status(500).json({ error: "Could not create room" });
  }
});

// ═══════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = router;