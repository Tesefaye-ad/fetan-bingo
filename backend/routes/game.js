const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const auth = require("./auth");
const { requireAuth } = auth;
const {
  generate1250Cards,
  getPatternForRoom,
} = require("../utils/bingoCard");

const router = express.Router();
router.use(requireAuth);

const TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);

// ═══════════════════════════════════════════════════════
// 🕛 DAILY — ማታ 12:00 / 12:05 EAT
// ═══════════════════════════════════════════════════════
function getNextDailyStart(fee) {
  const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const et = new Date(now.getTime() + ETHIOPIA_OFFSET_MS);

  const targetHour = 0;
  const targetMinute = fee === 50 ? 0 : 5;

  const today = new Date(et);
  today.setUTCHours(targetHour, targetMinute, 0, 0);

  let next;
  if (et.getTime() < today.getTime()) {
    next = today;
  } else {
    next = new Date(today);
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return new Date(next.getTime() - ETHIOPIA_OFFSET_MS);
}

function getRoomFeeConfig(roomCode, fallbackFee) {
  if (roomCode === "ROOM50") return { isWeekly: true, fee: 50 };
  if (roomCode === "ROOM100") return { isWeekly: true, fee: 100 };
  return {
    isWeekly: false,
    fee: Number(fallbackFee ?? process.env.ENTRY_FEE ?? 10),
  };
}

// ═══════════════════════════════════════════════════════
// 🕐 Compute target time & remaining
// ═══════════════════════════════════════════════════════
function computeTargetTime(game) {
  if (game.isWeeklyGame && game.scheduledStart) {
    return new Date(game.scheduledStart);
  }
  if (game.selectionEndsAt) {
    return new Date(game.selectionEndsAt);
  }
  return null;
}

function computeRemaining(game) {
  const targetTime = computeTargetTime(game);
  if (!targetTime || game.status !== "waiting") {
    return { targetTime, remainingSeconds: 0 };
  }
  const remainingSeconds = Math.max(
    0,
    Math.floor((targetTime.getTime() - Date.now()) / 1000)
  );
  return { targetTime, remainingSeconds };
}

// ═══════════════════════════════════════════════════════
// 🎯 Ensure room exists with a VALID timer
// ═══════════════════════════════════════════════════════
async function ensureRoomWithTimer(roomCode) {
  const { isWeekly, fee } = getRoomFeeConfig(roomCode);
  let game = await Game.findOne({ roomCode });
  const now = Date.now();

  if (!game) {
    // Create new room with fresh timer
    const targetTime = isWeekly
      ? getNextDailyStart(fee)
      : new Date(now + TIMER_MS);

    game = await Game.create({
      roomCode,
      entryFee: fee,
      maxNumber: 75,
      allCards: generate1250Cards(),
      isWeeklyGame: isWeekly,
      status: "waiting",
      winPattern: getPatternForRoom(fee),
      ...(isWeekly
        ? { scheduledStart: targetTime }
        : { selectionEndsAt: targetTime }),
    });
    console.log(
      `[ensureRoom] ${roomCode} created — target ${targetTime.toISOString()}`
    );
    return game;
  }

  // Room exists — regenerate cards if needed
  if (!game.allCards?.length || game.allCards.length < 1250) {
    game.allCards = generate1250Cards();
    await game.save();
  }

  // ═══════════════════════════════════════════════════════
  // 👈 ONLY reset if timer is MISSING or EXPIRED
  // ═══════════════════════════════════════════════════════
  if (game.status === "waiting") {
    const targetTime = computeTargetTime(game);
    const targetMs = targetTime ? targetTime.getTime() : 0;

    if (!targetMs || targetMs <= now) {
      // Timer expired or missing — reset with fresh timer
      const newTarget = isWeekly
        ? getNextDailyStart(fee)
        : new Date(now + TIMER_MS);

      game.selectionEndsAt = isWeekly ? undefined : newTarget;
      game.scheduledStart = isWeekly ? newTarget : undefined;
      await game.save();

      console.log(
        `[ensureRoom] ${roomCode} timer reset — target ${newTarget.toISOString()}`
      );
    }
    // else: timer is valid → DON'T touch it
  }

  return game;
}

// ═══════════════════════════════════════════════════════
// GET /rooms/:roomCode
// ═══════════════════════════════════════════════════════
router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    const game = await ensureRoomWithTimer(roomCode);
    const { targetTime, remainingSeconds } = computeRemaining(game);

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
      selectionEndsAt: targetTime,
      scheduledStart: game.scheduledStart,
      serverTime: new Date().toISOString(),
      remainingSeconds,
      isWeeklyGame: game.isWeeklyGame || false,
      winnersCount: game.winners?.length || 0,
    });
  } catch (err) {
    console.error("[GET /rooms/:roomCode]", err);
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

// ═══════════════════════════════════════════════════════
// POST /rooms
// ═══════════════════════════════════════════════════════
router.post("/rooms", async (req, res) => {
  try {
    let { roomCode, entryFee } = req.body;
    roomCode = (roomCode || generateRoomCode()).trim().toUpperCase();

    const game = await ensureRoomWithTimer(roomCode);
    const { targetTime, remainingSeconds } = computeRemaining(game);

    res.status(201).json({
      roomCode: game.roomCode,
      status: game.status,
      entryFee: game.entryFee,
      prizePool: game.prizePool,
      playerCount: game.players.length,
      selectionEndsAt: targetTime,
      scheduledStart: game.scheduledStart,
      serverTime: new Date().toISOString(),
      remainingSeconds,
      isWeeklyGame: game.isWeeklyGame || false,
    });
  } catch (err) {
    console.error("[POST /rooms]", err);
    res.status(500).json({ error: "Could not create room" });
  }
});

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = router;