const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const auth = require("./auth");
const { requireAuth } = auth;
const { generate1250Cards, getPatternForRoom } = require("../utils/bingoCard");

const router = express.Router();
router.use(requireAuth);

const TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);

function getNextDailyStart(fee) {
  const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const et = new Date(now.getTime() + ETHIOPIA_OFFSET_MS);
  const targetHour = 0;
  const targetMinute = fee === 50 ? 0 : 5;
  const today = new Date(et);
  today.setUTCHours(targetHour, targetMinute, 0, 0);
  let next;
  if (et.getTime() < today.getTime()) next = today;
  else {
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

async function resetRoomToWaiting(game, isWeekly, fee) {
  game.entryFee = fee;
  game.isWeeklyGame = isWeekly;
  game.winPattern = getPatternForRoom(fee);
  game.status = "waiting";
  game.calledNumbers = [];
  game.prizePool = 0;
  game.players = [];
  game.reservedCards = [];
  game.winners = [];
  game.winningCartelas = [];
  game.startedAt = undefined;
  game.finishedAt = undefined;
  if (isWeekly) {
    game.scheduledStart = getNextDailyStart(fee);
    game.selectionEndsAt = undefined;
  } else {
    game.selectionEndsAt = new Date(Date.now() + TIMER_MS);
    game.scheduledStart = undefined;
  }
  await game.save();
}

function computeRemaining(game) {
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
  return { targetTime, remainingSeconds };
}

// ═══════════════════════════════════════════════════════
// GET /rooms/:roomCode — 👈 ሰዓቱን ፈጽሞ አትቀይር
// ═══════════════════════════════════════════════════════
router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    const { isWeekly, fee } = getRoomFeeConfig(roomCode);
    let game = await Game.findOne({ roomCode });

    if (!game) {
      game = await Game.create({
        roomCode,
        entryFee: fee,
        maxNumber: 75,
        allCards: generate1250Cards(),
        isWeeklyGame: isWeekly,
        status: "waiting",
        winPattern: getPatternForRoom(fee),
        ...(isWeekly
          ? { scheduledStart: getNextDailyStart(fee) }
          : { selectionEndsAt: new Date(Date.now() + TIMER_MS) }),
      });
      console.log(`[GET] Auto-created ${roomCode}`);
    } else if (!game.allCards?.length || game.allCards.length < 1250) {
      game.allCards = generate1250Cards();
      await game.save();
    }

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
// POST /rooms — 👈 ሰዓቱ ካለ ፈጽሞ አትንካ
// ═══════════════════════════════════════════════════════
router.post("/rooms", async (req, res) => {
  try {
    let { roomCode, entryFee } = req.body;
    roomCode = (roomCode || generateRoomCode()).trim().toUpperCase();
    const { isWeekly, fee } = getRoomFeeConfig(roomCode, entryFee);
    let game = await Game.findOne({ roomCode });

    if (!game) {
      // 👈 አዲስ — ፍጠር
      game = await Game.create({
        roomCode,
        entryFee: fee,
        maxNumber: 75,
        allCards: generate1250Cards(),
        isWeeklyGame: isWeekly,
        status: "waiting",
        winPattern: getPatternForRoom(fee),
        ...(isWeekly
          ? { scheduledStart: getNextDailyStart(fee) }
          : { selectionEndsAt: new Date(Date.now() + TIMER_MS) }),
      });
      console.log(`[POST] ${roomCode} created`);
    } else {
      // ═══════════════════════════════════════════════════
      // 👈 ሰዓቱ ካለ → ፈጽሞ አትንካ (ሁሉም ዩዘሮች አንድ ዓይነት ሰዓት ያያሉ)
      // ═══════════════════════════════════════════════════
      const now = Date.now();
      const isEmpty =
        game.players.length === 0 && (game.reservedCards || []).length === 0;

      let hasValidTimer = false;
      if (game.isWeeklyGame && game.scheduledStart) {
        hasValidTimer = new Date(game.scheduledStart).getTime() > now;
      } else if (game.selectionEndsAt) {
        hasValidTimer = new Date(game.selectionEndsAt).getTime() > now;
      }

      if (isEmpty && !hasValidTimer) {
        // ሰዓቱ አልቋል + ባዶ → reset
        await resetRoomToWaiting(game, isWeekly, fee);
        console.log(`[POST] ${roomCode} reset (expired)`);
      } else {
        console.log(
          `[POST] ${roomCode} kept (timer still active or has players)`
        );
      }
    }

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