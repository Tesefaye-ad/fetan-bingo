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
const EXPIRY_GRACE_MS = 3000; // 👈 3s ከሆነ በኋላ reset ያደርጋል

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
// 👈 አዲስ: Room factory (ሁሉም ቦታ ይጠቀምበታል)
// ═══════════════════════════════════════════════════════
function buildNewRoom(roomCode, isWeekly, fee) {
  const data = {
    roomCode,
    entryFee: fee,
    maxNumber: 75,
    allCards: generate1250Cards(),
    isWeeklyGame: isWeekly,
    status: "waiting",
    winPattern: getPatternForRoom(fee),
    calledNumbers: [],
    prizePool: 0,
    players: [],
    reservedCards: [],
    winners: [],
    winningCartelas: [],
    startedAt: undefined,
    finishedAt: undefined,
  };
  if (isWeekly) {
    data.scheduledStart = getNextDailyStart(fee);
    data.selectionEndsAt = undefined;
  } else {
    data.selectionEndsAt = new Date(Date.now() + TIMER_MS);
    data.scheduledStart = undefined;
  }
  return data;
}

// ═══════════════════════════════════════════════════════
// 👈 አዲስ: Reset expired room (ሁሉንም አጽዳ + አዲስ ሰዓት)
// ═══════════════════════════════════════════════════════
async function resetExpiredRoom(game) {
  const now = Date.now();
  const isWeekly = game.isWeeklyGame;

  // ጨዋታ የሚጫወት ሰው ካለ → አትንካ
  const hasPlayers =
    game.players.length > 0 || (game.reservedCards || []).length > 0;
  if (hasPlayers) return false;

  if (isWeekly) {
    const sched = game.scheduledStart
      ? new Date(game.scheduledStart).getTime()
      : 0;
    if (sched > 0 && sched < now - EXPIRY_GRACE_MS) {
      game.scheduledStart = getNextDailyStart(game.entryFee);
      game.selectionEndsAt = undefined;
      game.status = "waiting";
      game.calledNumbers = [];
      game.prizePool = 0;
      game.winners = [];
      game.winningCartelas = [];
      await game.save();
      console.log(
        `[reset] ${game.roomCode} weekly expired → ${game.scheduledStart.toISOString()}`
      );
      return true;
    }
  } else {
    const sel = game.selectionEndsAt
      ? new Date(game.selectionEndsAt).getTime()
      : 0;
    if (sel > 0 && sel < now - EXPIRY_GRACE_MS) {
      game.selectionEndsAt = new Date(now + TIMER_MS);
      game.scheduledStart = undefined;
      game.status = "waiting";
      game.calledNumbers = [];
      game.prizePool = 0;
      game.winners = [];
      game.winningCartelas = [];
      await game.save();
      console.log(
        `[reset] ${game.roomCode} timer expired → ${TIMER_MS / 1000}s`
      );
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════
// 👈 አዲስ: Compute remaining
// ═══════════════════════════════════════════════════════
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
// GET /rooms/:roomCode — Auto-create + auto-reset + timer
// ═══════════════════════════════════════════════════════
router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    let game = await Game.findOne({ roomCode });

    // ─── 1. Auto-create ካልተገኘ ───
    if (!game) {
      const { isWeekly, fee } = getRoomFeeConfig(roomCode);
      game = await Game.create(buildNewRoom(roomCode, isWeekly, fee));
      console.log(`[GET] Auto-created ${roomCode} weekly=${isWeekly}`);
    } else if (!game.allCards?.length || game.allCards.length < 1250) {
      game.allCards = generate1250Cards();
      await game.save();
    }

    // ─── 2. Weekly without scheduledStart — fix ───
    if (
      game.isWeeklyGame &&
      !game.scheduledStart &&
      game.status === "waiting"
    ) {
      game.scheduledStart = getNextDailyStart(game.entryFee);
      game.selectionEndsAt = undefined;
      await game.save();
    }

    // ─── 3. Auto-reset expired ───
    if (game.status === "waiting") {
      await resetExpiredRoom(game);
    }

    // ─── 4. Compute remaining ───
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
// POST /rooms — Create if not exists
// ═══════════════════════════════════════════════════════
router.post("/rooms", async (req, res) => {
  try {
    let { roomCode, entryFee } = req.body;
    roomCode = (roomCode || generateRoomCode()).trim().toUpperCase();

    const { isWeekly, fee } = getRoomFeeConfig(roomCode, entryFee);
    let game = await Game.findOne({ roomCode });

    if (!game) {
      game = await Game.create(buildNewRoom(roomCode, isWeekly, fee));
    } else if (game.status === "waiting") {
      await resetExpiredRoom(game);
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