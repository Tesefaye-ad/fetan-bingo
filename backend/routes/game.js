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
// 🕐 DAILY — በየ24 ሰዓቱ አንድ ጊዜ (12:00/12:05 EAT)
// ═══════════════════════════════════════════════════════
function getNextDailyStart(fee) {
  const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const et = new Date(now.getTime() + ETHIOPIA_OFFSET_MS);

  const targetHour = 0; // 👈 ማታ 12:00 EAT (midnight)
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
// GET /rooms/:roomCode — Auto-create + return timer info
// ═══════════════════════════════════════════════════════
router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    let game = await Game.findOne({ roomCode });

    if (!game) {
      const { isWeekly, fee } = getRoomFeeConfig(roomCode);
      const newGame = {
        roomCode,
        entryFee: fee,
        maxNumber: 75,
        allCards: generate1250Cards(),
        isWeeklyGame: isWeekly,
        status: "waiting",
        winPattern: getPatternForRoom(fee),
      };
      if (isWeekly) {
        newGame.scheduledStart = getNextDailyStart(fee);
      } else {
        newGame.selectionEndsAt = new Date(Date.now() + TIMER_MS);
      }
      game = await Game.create(newGame);
      console.log(`[GET] Auto-created ${roomCode} weekly=${isWeekly}`);
    } else if (!game.allCards?.length || game.allCards.length < 1250) {
      game.allCards = generate1250Cards();
      await game.save();
    }

    // Auto-fix weekly without scheduledStart
    if (
      game.isWeeklyGame &&
      !game.scheduledStart &&
      game.status === "waiting"
    ) {
      game.scheduledStart = getNextDailyStart(game.entryFee);
      game.selectionEndsAt = undefined;
      await game.save();
    }

    // ═══════════════════════════════════════════════════════
    // Compute targetTime
    // ═══════════════════════════════════════════════════════
    let targetTime = null;
    if (game.isWeeklyGame && game.scheduledStart) {
      targetTime = new Date(game.scheduledStart);
    } else if (game.selectionEndsAt) {
      targetTime = new Date(game.selectionEndsAt);
    }

    let remainingSeconds = 0;
    if (targetTime && game.status === "waiting") {
      remainingSeconds = Math.max(
        0,
        Math.floor((targetTime.getTime() - Date.now()) / 1000)
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
// POST /rooms — Create if not exists
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
        maxNumber: 75,
        allCards: generate1250Cards(),
        isWeeklyGame: isWeekly,
        winPattern: getPatternForRoom(fee),
      };
      if (isWeekly) {
        data.scheduledStart = getNextDailyStart(fee);
      } else {
        data.selectionEndsAt = new Date(Date.now() + TIMER_MS);
      }
      game = await Game.create(data);
    }

    let targetTime = null;
    if (game.isWeeklyGame && game.scheduledStart) {
      targetTime = new Date(game.scheduledStart);
    } else if (game.selectionEndsAt) {
      targetTime = new Date(game.selectionEndsAt);
    }

    let remainingSeconds = 0;
    if (targetTime && game.status === "waiting") {
      remainingSeconds = Math.max(
        0,
        Math.floor((targetTime.getTime() - Date.now()) / 1000)
      );
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