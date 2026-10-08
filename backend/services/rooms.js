// ═══════════════════════════════════════════════════════
// ROOMS SERVICE — ለ REST እና ለ Socket የሚጋራ የክፍል አስተዳደር
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
// 👈 ቀላል እና ከባድ ፓተርኖች
// ═══════════════════════════════════════════════════════

// 🟢 ቀላል ዝጎች — Play 10, 20
const EASY_PATTERNS = ["any-row", "any-column"];

// 🔴 ከባድ ዝጎች — Play 50, 100
const HARD_PATTERNS = ["any-diagonal", "four-corners", "full-card"];

// የእያንዳንዱ ፓተርን የመመረጥ ዕድል (ክብደት)
const PATTERN_WEIGHTS = {
  // 🟢 ቀላል
  "any-row": 6, // 60%
  "any-column": 4, // 40%
  // 🔴 ከባድ
  "any-diagonal": 4, // 40%
  "four-corners": 4, // 40%
  "full-card": 2, // 20%
};

// ገደብ — ከዚህ በታች ቀላል፣ ከዚህ በላይ ከባድ
const HARD_STAKE_THRESHOLD = Number(process.env.HARD_STAKE_THRESHOLD || 50);

/**
 * 👈 በSTAKE ደረጃ የተመደበ ራንደም ፓተርን ይመርጣል
 * @param {number} fee — የጨዋታው ድርሻ (10, 20, 50, 100)
 * @returns {string} — የተመረጠው ፓተርን
 */
function pickRandomPattern(fee) {
  const feeNum = Number(fee) || 10;
  const isHard = feeNum >= HARD_STAKE_THRESHOLD;
  const pool = isHard ? HARD_PATTERNS : EASY_PATTERNS;

  // ክብደት ተጠቅሞ pool መፍጠር
  const weightPool = [];
  for (const p of pool) {
    const w = PATTERN_WEIGHTS[p] || 1;
    for (let i = 0; i < w; i++) weightPool.push(p);
  }

  return weightPool[Math.floor(Math.random() * weightPool.length)];
}

/**
 * 👈 የክፍሉን የማሸነፊያ ፓተርን ይወስናል
 * - ROOM10/ROOM20 → ቀላል
 * - ROOM50/ROOM100 → ከባድ
 */
function patternForRoom(roomCode, fee) {
  return pickRandomPattern(fee);
}

/** የሚታወቁ ክፍሎች ብቻ ይፈቀዳሉ */
function normalizeRoomCode(code) {
  const c = String(code || "").trim().toUpperCase();
  return DEFAULT_ROOMS.includes(c) ? c : null;
}

/** ROOM10 → 10, ROOM20 → 20, ROOM50 → 50, ROOM100 → 100 */
function feeForRoom(roomCode, hint) {
  if (isWeeklyRoom(roomCode)) return getWeeklyFee(roomCode);
  const m = /^ROOM(\d+)$/.exec(roomCode);
  if (m) return Number(m[1]);
  return Number(hint) || Number(process.env.ENTRY_FEE || 10);
}

/** ወደ "waiting" ለመመለስ የሚያስፈልጉ ሁሉም መስኮች */
function waitingFields(roomCode, fee) {
  const weekly = isWeeklyRoom(roomCode);
  const pattern = patternForRoom(roomCode, fee);
  return {
    status: "waiting",
    entryFee: fee,
    isWeeklyGame: weekly,
    winPattern: pattern, // 👈 በየዙሩ ይቀያየራል
    calledNumbers: [],
    prizePool: 0,
    players: [],
    reservedCards: [],
    winners: [],
    winningCartelas: [],
    startedAt: null,
    finishedAt: null,
    scheduledStart: weekly ? getNextDailyStart(fee) : null,
    selectionEndsAt: weekly ? null : new Date(Date.now() + SELECTION_TIMER_MS),
  };
}

// ትልልቅ መስኮችን (allCards, የካርድ ፍርግርግ) የማያነብ — ለሁሉም መደበኛ ንባብ
const LIGHT_SELECT = "-allCards -players.card -players.marked";

async function ensureRoom(roomCode, feeHint) {
  const existing = await Game.findOne({ roomCode }).select(LIGHT_SELECT);
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
    if (err.code !== 11000) throw err; // ሌላ ሰው አስቀድሞ ፈጥሮታል
  }
  return Game.findOne({ roomCode }).select(LIGHT_SELECT);
}

/** ሰርቨር ሲነሳ ብቻ — የ 1250 ካርዶች ስብስብ ሙሉ መሆኑን ያረጋግጣል */
async function ensureRoomCards(roomCode) {
  const g = await Game.findOne({ roomCode }).select("allCards");
  if (g && (!g.allCards || g.allCards.length < TOTAL_CARDS)) {
    g.allCards = generate1250Cards();
    await g.save();
  }
}

/** ክፍሉን ወደ አዲስ "waiting" ዙር ይመልሳል */
async function resetToWaiting(roomCode) {
  const current = await Game.findOne({ roomCode }).select("entryFee");
  const fee = current?.entryFee || feeForRoom(roomCode);
  // 👈 ራስ-ሰር አዲስ ራንደም ፓተርን ይመርጣል (በ fee ደረጃ)
  return Game.findOneAndUpdate(
    { roomCode },
    { $set: waitingFields(roomCode, fee) },
    { new: true }
  );
}

// ═══════════════════════════════════════════════════════
// publicState — UNIQUE USER COUNT + TOTAL CARDS
// ═══════════════════════════════════════════════════════
function publicState(game) {
  const deadline =
    game.isWeeklyGame && game.scheduledStart
      ? game.scheduledStart
      : game.selectionEndsAt;
  const now = Date.now();

  // 👈 የተለያዩ ተጠቃሚዎች ብዛት
  const uniqueUserIds = new Set();
  for (const p of game.players || []) {
    const key = String(p.user || p.telegramId || "");
    if (key) uniqueUserIds.add(key);
  }

  // 👈 ጠቅላላ ካርቴላዎች
  const totalCards = (game.players || []).length;

  return {
    roomCode: game.roomCode,
    status: game.status,
    entryFee: game.entryFee,
    prizePool: game.prizePool,
    playerCount: uniqueUserIds.size,
    totalCards,
    calledNumbers: game.calledNumbers,
    maxNumber: game.maxNumber,
    takenCards: (game.players || []).map((p) => p.cardId),
    reservedCards: (game.reservedCards || []).map((r) => r.cardId),
    winPattern: game.winPattern || "any-row",
    isWeeklyGame: !!game.isWeeklyGame,
    selectionEndsAt: game.status === "waiting" && deadline ? deadline : null,
    scheduledStart: game.scheduledStart || null,
    serverTime: new Date(now).toISOString(),
    serverNow: now,
    remainingMs:
      game.status === "waiting" && deadline
        ? Math.max(0, new Date(deadline).getTime() - now)
        : 0,
  };
}

module.exports = {
  SELECTION_TIMER_MS,
  MAX_NUMBER,
  DEFAULT_ROOMS,
  // 👈 ፓተርን ተዛማጅ exports
  EASY_PATTERNS,
  HARD_PATTERNS,
  PATTERN_WEIGHTS,
  HARD_STAKE_THRESHOLD,
  pickRandomPattern,
  patternForRoom,
  // መደበኛ exports
  normalizeRoomCode,
  feeForRoom,
  waitingFields,
  LIGHT_SELECT,
  ensureRoom,
  ensureRoomCards,
  resetToWaiting,
  publicState,
};