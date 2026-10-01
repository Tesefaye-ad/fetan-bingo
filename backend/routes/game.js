const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const auth = require("./auth");
const { requireAuth } = auth;
const { generate1250Cards, TOTAL_CARDS } = require("../utils/bingoCard");

const router = express.Router();
router.use(requireAuth);

const TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);

// ═══════════════════════════════════════════════════════
// 🕐 DAILY — በየቀኑ 12:00 / 12:05 EAT (ማታ)
// ═══════════════════════════════════════════════════════
function getNextDailyStart(fee) {
  const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const et = new Date(now.getTime() + ETHIOPIA_OFFSET_MS);

  const targetHour = 0; // 👈 ማታ 12:00 (midnight)
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
// GET /rooms/:roomCode
// ═══════════════════════════════════════════════════════
router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    let game = await Game.findOne({ roomCode });
    if (!game) return res.status(404).json({ error: "Room not found" });

    // ═══════════════════════════════════════════════════════
    // 🕐 AUTO-FIX: Weekly room without scheduledStart
    // ═══════════════════════════════════════════════════════
    if (
      game.isWeeklyGame &&
      !game.scheduledStart &&
      game.status === "waiting"
    ) {
      game.scheduledStart = getNextDailyStart(game.entryFee);
      game.selectionEndsAt = undefined;
      await game.save();
      console.log(
        `[GET] Fixed ${roomCode} scheduledStart=${game.scheduledStart.toISOString()}`
      );
    }

    // ═══════════════════════════════════════════════════════
    // 🕐 COMPUTE remainingSeconds (server-side)
    // ═══════════════════════════════════════════════════════
    let targetTime = null;

    if (game.isWeeklyGame && game.scheduledStart) {
      targetTime = new Date(game.scheduledStart);
    } else if (game.selectionEndsAt) {
      targetTime = new Date(game.selectionEndsAt);
    }

    let remainingSeconds = 0;
    if (targetTime && game.status === "waiting") {
      const diff = targetTime.getTime() - Date.now();
      remainingSeconds = Math.max(0, Math.floor(diff / 1000));
    }

    console.log(
      `[GET] ${roomCode} — weekly=${game.isWeeklyGame} status=${
        game.status
      } target=${targetTime?.toISOString()} remaining=${remainingSeconds}s`
    );

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
// POST /rooms — ክፍል ፍጠር / አስመልስ
// ═══════════════════════════════════════════════════════
router.post("/rooms", async (req, res) => {
  try {
    let { roomCode, entryFee } = req.body;
    roomCode = (roomCode || generateRoomCode()).trim().toUpperCase();
    const { isWeekly, fee } = getRoomFeeConfig(roomCode, entryFee);
    let game = await Game.findOne({ roomCode });

    if (!game) {
      const data = {
        roomCode,
        entryFee: fee,
        maxNumber: Number(process.env.BINGO_MAX_NUMBER || 75),
        allCards: generate1250Cards(), // 👈 1250
        isWeeklyGame: isWeekly,
        status: "waiting",
      };

      if (isWeekly) {
        data.scheduledStart = getNextDailyStart(fee); // 👈 DAILY
      } else {
        data.selectionEndsAt = new Date(Date.now() + TIMER_MS);
      }

      game = await Game.create(data);
      console.log(
        `[POST] Created ${roomCode} — weekly=${isWeekly} fee=${fee}`
      );
    } else if (
      !game.allCards?.length ||
      game.allCards.length < TOTAL_CARDS
    ) {
      // 👈 ካርዶች ካነሱ እንደገና ፍጠር
      game.allCards = generate1250Cards();
      await game.save();
      console.log(`[POST] Refilled cards for ${roomCode}`);
    }

    // ═══════════════════════════════════════════════════════
    // 🕐 COMPUTE remainingSeconds
    // ═══════════════════════════════════════════════════════
    let targetTime = null;

    if (game.isWeeklyGame && game.scheduledStart) {
      targetTime = new Date(game.scheduledStart);
    } else if (game.selectionEndsAt) {
      targetTime = new Date(game.selectionEndsAt);
    }

    let remainingSeconds = 0;
    if (targetTime && game.status === "waiting") {
      const diff = targetTime.getTime() - Date.now();
      remainingSeconds = Math.max(0, Math.floor(diff / 1000));
    }

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