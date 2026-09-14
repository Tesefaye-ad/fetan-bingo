const express = require("express");
const Game = require("../models/Game");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

/**
 * GET /api/game/rooms
 * Lists rooms that are still open to join (waiting for players).
 */
router.get("/rooms", async (req, res) => {
  try {
    const rooms = await Game.find({ status: "waiting" })
      .sort({ createdAt: -1 })
      .limit(30)
      .select("roomCode status entryFee prizePool players maxNumber");

    res.json({
      rooms: rooms.map((g) => ({
        roomCode: g.roomCode,
        status: g.status,
        entryFee: g.entryFee,
        prizePool: g.prizePool,
        playerCount: g.players.length,
        maxNumber: g.maxNumber,
      })),
    });
  } catch (err) {
    console.error("[GET /api/game/rooms] error:", err);
    res.status(500).json({ error: "Could not load rooms" });
  }
});

/**
 * POST /api/game/rooms
 * Body: { roomCode?: string, entryFee?: number }
 * Creates a new waiting room. If roomCode is omitted, a random one is generated.
 * Actually joining (deducting the entry fee, dealing a card) happens over
 * Socket.io via the "join_room" event - see socket/gameSocket.js.
 */
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
      });
    }

    res.status(201).json({
      roomCode: game.roomCode,
      status: game.status,
      entryFee: game.entryFee,
      prizePool: game.prizePool,
      playerCount: game.players.length,
    });
  } catch (err) {
    console.error("[POST /api/game/rooms] error:", err);
    res.status(500).json({ error: "Could not create room" });
  }
});

/**
 * GET /api/game/rooms/:roomCode
 * Fetch the current public state of a single room.
 */
router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    const game = await Game.findOne({ roomCode }).select(
      "roomCode status entryFee prizePool players calledNumbers maxNumber"
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
    });
  } catch (err) {
    console.error("[GET /api/game/rooms/:roomCode] error:", err);
    res.status(500).json({ error: "Could not load room" });
  }
});

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

module.exports = router;
