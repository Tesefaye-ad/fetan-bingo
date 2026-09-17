const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

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
      selectionEndsAt: game.selectionEndsAt, // 👈 አዲስ
      winnersCount: game.winners?.length || 0,
    });
  } catch (err) {
    console.error("[GET /api/game/rooms/:roomCode] error:", err);
    res.status(500).json({ error: "Could not load room" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalGames = await Game.countDocuments({ status: "finished" });
    res.json({ totalUsers, totalGames });
  } catch (err) {
    res.status(500).json({ error: "Could not load stats" });
  }
});

router.post("/rooms", async (req, res) => {
  try {
    let { roomCode, entryFee } = req.body;
    roomCode = (roomCode || generateRoomCode()).trim().toUpperCase();
    entryFee = Number(entryFee ?? process.env.ENTRY_FEE ?? 10);

    let game = await Game.findOne({ roomCode });
    if (!game) {
      // 👈 አዲስ ክፍል ሲፈጠር የምርጫ ሰዓቱን አስቀምጥ
      game = await Game.create({
        roomCode,
        entryFee,
        maxNumber: Number(process.env.BINGO_MAX_NUMBER || 75),
        selectionEndsAt: new Date(Date.now() + 60000),
      });
    } else if (game.status === "waiting" && (!game.selectionEndsAt || game.selectionEndsAt < new Date())) {
      // 👈 ሰዓቱ ካለፈ ብቻ አድስ (ክፍሉ ገና waiting ከሆነ)
      game.selectionEndsAt = new Date(Date.now() + 60000);
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

router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    const game = await Game.findOne({ roomCode }).select(
      "roomCode status entryFee prizePool players calledNumbers maxNumber winners"
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
      winnersCount: game.winners?.length || 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load room" });
  }
});

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = router;