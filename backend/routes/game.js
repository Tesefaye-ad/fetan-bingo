const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);

// ═══════════════════════════════════════════════════════
// 👈 ሳምንታዊ ጨዋታ — ቀጣዩን ቅዳሜ ማታ 12:00/12:05 አስላ
// ═══════════════════════════════════════════════════════
function getNextWeeklyStart(fee) {
  // የኢትዮጵያ ሰዓት (UTC+3)
  const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const ethiopiaNow = new Date(now.getTime() + ETHIOPIA_OFFSET_MS);

  const targetDay = 6; // ቅዳሜ (0=እሑድ, 6=ቅዳሜ)
  const targetHour = 0; // 12:00 AM Ethiopian (ወደ UTC ሲቀየር — ይህ ማለት 12:00 AM)
  const targetMinute = fee === 50 ? 0 : 5;

  let daysUntil = (targetDay - ethiopiaNow.getUTCDay() + 7) % 7;
  if (daysUntil === 0) {
    const todayTarget = new Date(ethiopiaNow);
    todayTarget.setUTCHours(targetHour, targetMinute, 0, 0);
    if (ethiopiaNow >= todayTarget) daysUntil = 7;
  }

  const nextStart = new Date(ethiopiaNow);
  nextStart.setUTCDate(nextStart.getUTCDate() + daysUntil);
  nextStart.setUTCHours(targetHour, targetMinute, 0, 0);

  // ወደ UTC ቀይረው
  return new Date(nextStart.getTime() - ETHIOPIA_OFFSET_MS);
}

// ═══════════════════════════════════════════════════════
// GET /rooms/:roomCode
// ═══════════════════════════════════════════════════════
router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    const game = await Game.findOne({ roomCode }).select(
      "roomCode status entryFee prizePool players calledNumbers maxNumber winners reservedCards selectionEndsAt scheduledStart isWeeklyGame"
    );
    if (!game) return res.status(404).json({ error: "Room not found" });

    // 👈 የመደበኛ ጨዋታ — የቀረውን ሰከንድ አስላ
    let remainingSeconds = 0;
    if (!game.isWeeklyGame && game.selectionEndsAt) {
      remainingSeconds = Math.max(
        0,
        Math.floor((new Date(game.selectionEndsAt).getTime() - Date.now()) / 1000)
      );
    }

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
      remainingSeconds,
      scheduledStart: game.scheduledStart, // 👈 ሳምንታዊ
      isWeeklyGame: game.isWeeklyGame || false, // 👈 ሳምንታዊ ነው?
      winnersCount: game.winners?.length || 0,
    });
  } catch (err) {
    console.error("[GET /api/game/rooms/:roomCode] error:", err);
    res.status(500).json({ error: "Could not load room" });
  }
});

// ═══════════════════════════════════════════════════════
// GET /stats
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
// GET /rooms
// ═══════════════════════════════════════════════════════
router.get("/rooms", async (req, res) => {
  try {
    const rooms = await Game.find({ status: "waiting" })
      .sort({ createdAt: -1 })
      .limit(30)
      .select("roomCode status entryFee prizePool players maxNumber selectionEndsAt scheduledStart isWeeklyGame");

    res.json({
      rooms: rooms.map((g) => ({
        roomCode: g.roomCode,
        status: g.status,
        entryFee: g.entryFee,
        prizePool: g.prizePool,
        playerCount: g.players.length,
        maxNumber: g.maxNumber,
        selectionEndsAt: g.selectionEndsAt,
        scheduledStart: g.scheduledStart,
        isWeeklyGame: g.isWeeklyGame || false,
      })),
    });
  } catch (err) {
    console.error("[GET /api/game/rooms] error:", err);
    res.status(500).json({ error: "Could not load rooms" });
  }
});

// ═══════════════════════════════════════════════════════
// POST /rooms — ክፍሉ ካለ ሰዓቱን አትቀይር
// ═══════════════════════════════════════════════════════
router.post("/rooms", async (req, res) => {
  try {
    let { roomCode, entryFee } = req.body;
    roomCode = (roomCode || generateRoomCode()).trim().toUpperCase();
    entryFee = Number(entryFee ?? process.env.ENTRY_FEE ?? 10);

    let game = await Game.findOne({ roomCode });
    if (!game) {
      // 👈 ሳምንታዊ ጨዋታ ነው?
      const isWeekly = roomCode === "ROOM50" || roomCode === "ROOM100";
      const weeklyFee = roomCode === "ROOM50" ? 50 : roomCode === "ROOM100" ? 100 : entryFee;

      const newGameData = {
        roomCode,
        entryFee: Number(process.env.ENTRY_FEE || weeklyFee),
        maxNumber: Number(process.env.BINGO_MAX_NUMBER || 75),
        allCards: [],
        winners: [],
        reservedCards: [],
        isWeeklyGame: isWeekly,
      };

      if (isWeekly) {
        // 👈 ሳምንታዊ — በተዘጋጀው ቀን ብቻ ይጀምራል
        newGameData.scheduledStart = getNextWeeklyStart(weeklyFee);
      } else {
        // 👈 መደበኛ — 50 ሰከንድ
        newGameData.selectionEndsAt = new Date(Date.now() + TIMER_MS);
      }

      game = await Game.create(newGameData);
    }
    // 👈 ክፍሉ ካለ ሰዓቱን ፈጽሞ አትቀይር!

    let remainingSeconds = 0;
    if (!game.isWeeklyGame && game.selectionEndsAt) {
      remainingSeconds = Math.max(
        0,
        Math.floor((new Date(game.selectionEndsAt).getTime() - Date.now()) / 1000)
      );
    }

    res.status(201).json({
      roomCode: game.roomCode,
      status: game.status,
      entryFee: game.entryFee,
      prizePool: game.prizePool,
      playerCount: game.players.length,
      selectionEndsAt: game.selectionEndsAt,
      remainingSeconds,
      scheduledStart: game.scheduledStart,
      isWeeklyGame: game.isWeeklyGame || false,
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