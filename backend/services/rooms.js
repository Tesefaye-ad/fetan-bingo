// ═══════════════════════════════════════════════════════
// ROOMS SERVICE — REST + Socket shared room management
// ═══════════════════════════════════════════════════════
const Game = require("../models/Game");
const { generate1250Cards, TOTAL_CARDS } = require("../utils/bingoCard");
const {
  getNextDailyStart,
  isWeeklyRoom,
  getWeeklyFee,
} = require("../utils/schedule");

const SELECTION_TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);
const MAX_NUMBER = 75;
const DEFAULT_ROOMS = ["ROOM10", "ROOM20", "ROOM50", "ROOM100"];

// ═══════════════════════════════════════════════════════
// 👈 NEW: cap cards per room to keep broadcast small
//    800 × 3 rooms = 2400 concurrent per process safely
//    For 4500 users, use more rooms or increase this value
// ═══════════════════════════════════════════════════════
const MAX_CARDS_PER_ROOM = Number(process.env.MAX_CARDS_PER_ROOM || 800);

const EASY_PATTERNS = ["any-row", "any-column"];
const HARD_PATTERNS = ["any-diagonal", "four-corners", "full-card"];

const PATTERN_WEIGHTS = {
  "any-row": 6,
  "any-column": 4,
  "any-diagonal": 4,
  "four-corners": 4,
  "full-card": 2,
};

const HARD_STAKE_THRESHOLD = Number(process.env.HARD_STAKE_THRESHOLD || 50);

function pickRandomPattern(fee) {
  const feeNum = Number(fee) || 10;
  const isHard = feeNum >= HARD_STAKE_THRESHOLD;
  const pool = isHard ? HARD_PATTERNS : EASY_PATTERNS;

  const weightPool = [];
  for (const p of pool) {
    const w = PATTERN_WEIGHTS[p] || 1;
    for (let i = 0; i < w; i++) weightPool.push(p);
  }

  return weightPool[Math.floor(Math.random() * weightPool.length)];
}

function patternForRoom(roomCode, fee) {
  return pickRandomPattern(fee);
}

function normalizeRoomCode(code) {
  const c = String(code || "").trim().toUpperCase();
  return DEFAULT_ROOMS.includes(c) ? c : null;
}

function feeForRoom(roomCode, hint) {
  if (isWeeklyRoom(roomCode)) return getWeeklyFee(roomCode);
  const m = /^ROOM(\d+)$/.exec(roomCode);
  if (m) return Number(m[1]);
  return Number(hint) || Number(process.env.ENTRY_FEE || 10);
}

// ═══════════════════════════════════════════════════════
// waitingFields — reset state for a new round
// ═══════════════════════════════════════════════════════
function waitingFields(roomCode, fee) {
  const weekly = isWeeklyRoom(roomCode);
  const pattern = patternForRoom(roomCode, fee);
  return {
    status: "waiting",
    entryFee: fee,
    isWeeklyGame: weekly,
    winPattern: pattern,
    calledNumbers: [],
    prizePool: 0,
    players: [],
    reservedCards: [],
    winners: [],
    winningCartelas: [],
    startedAt: null,
    finishedAt: null,
    notifiedAt: null,
    scheduledStart: weekly ? getNextDailyStart(fee) : null,
    selectionEndsAt: weekly ? null : new Date(Date.now() + SELECTION_TIMER_MS),
  };
}

// ═══════════════════════════════════════════════════════
// LIGHT_SELECT — omit heavy fields
// ═══════════════════════════════════════════════════════
const LIGHT_SELECT =
  "-allCards -players.card -players.marked -winningCartelas.card -winningCartelas.marked";

async function ensureRoom(roomCode, feeHint) {
  const existing = await Game.findOne({ roomCode }).select(LIGHT_SELECT).lean();
  if (existing) return existing;

  const fee = feeForRoom(roomCode, feeHint);
  try {
    await Game.create({
      roomCode,
      maxNumber: MAX_NUMBER,
      allCards: generate1250Cards(),
      ...waitingFields(roomCode, fee),
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return Game.findOne({ roomCode }).select(LIGHT_SELECT).lean();
}

async function ensureRoomCards(roomCode) {
  const g = await Game.findOne({ roomCode }).select("allCards").lean();
  if (g && (!g.allCards || g.allCards.length < TOTAL_CARDS)) {
    await Game.updateOne(
      { roomCode },
      { $set: { allCards: generate1250Cards() } }
    );
  }
}

async function resetToWaiting(roomCode) {
  const current = await Game.findOne({ roomCode }).select("entryFee").lean();
  const fee = current?.entryFee || feeForRoom(roomCode);

  return Game.findOneAndUpdate(
    { roomCode },
    { $set: waitingFields(roomCode, fee) },
    { new: true, projection: LIGHT_SELECT, lean: true }
  );
}

function publicState(game) {
  const deadline =
    game.isWeeklyGame && game.scheduledStart
      ? game.scheduledStart
      : game.selectionEndsAt;
  const now = Date.now();

  const uniqueUserIds = new Set();
  const takenCards = [];

  if (game.players?.length) {
    for (const p of game.players) {
      const key = String(p.user || p.telegramId || "");
      if (key) uniqueUserIds.add(key);
      if (p.cardId) takenCards.push(p.cardId);
    }
  }

  if (game.reservedCards?.length) {
    for (const r of game.reservedCards) {
      const key = String(r.user || r.telegramId || "");
      if (key) uniqueUserIds.add(key);
      if (r.cardId) takenCards.push(r.cardId);
    }
  }

  const remainingMs =
    game.status === "waiting" && deadline
      ? Math.max(0, new Date(deadline).getTime() - now)
      : 0;

  return {
    roomCode: game.roomCode,
    status: game.status,
    entryFee: game.entryFee,
    prizePool: game.prizePool,
    playerCount: uniqueUserIds.size,
    totalCards: takenCards.length,
    takenCards,
    calledNumbers: game.calledNumbers || [],
    maxNumber: game.maxNumber,
    winPattern: game.winPattern || "any-row",
    isWeeklyGame: !!game.isWeeklyGame,
    selectionEndsAt: game.status === "waiting" && deadline ? deadline : null,
    scheduledStart: game.scheduledStart || null,
    serverNow: now,
    remainingMs,
  };
}

module.exports = {
  SELECTION_TIMER_MS,
  MAX_NUMBER,
  DEFAULT_ROOMS,
  MAX_CARDS_PER_ROOM,   // 👈 NEW export
  EASY_PATTERNS,
  HARD_PATTERNS,
  PATTERN_WEIGHTS,
  HARD_STAKE_THRESHOLD,
  pickRandomPattern,
  patternForRoom,
  normalizeRoomCode,
  feeForRoom,
  waitingFields,
  LIGHT_SELECT,
  ensureRoom,
  ensureRoomCards,
  resetToWaiting,
  publicState,
};