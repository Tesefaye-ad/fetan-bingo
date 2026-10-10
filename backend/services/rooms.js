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

// ═══════════════════════════════════════════════════════
// 👈 LIGHT_SELECT — ትልቅ መስኮችን አያነብም
//     • allCards (1250 cards — ~200KB)
//     • players.card (5×5 grid per player)
//     • players.marked (5×5 bool per player)
//     • winningCartelas (ካርድ ፍርግርግ — ሲያሸንፍ ብቻ)
// ═══════════════════════════════════════════════════════
const LIGHT_SELECT =
  "-allCards -players.card -players.marked -winningCartelas.card -winningCartelas.marked";

// ═══════════════════════════════════════════════════════
// ensureRoom — ክፍሉ ከሌለ ይፈጥራል (race-safe)
// ═══════════════════════════════════════════════════════
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
    if (err.code !== 11000) throw err; // ሌላ ሰው አስቀድሞ ፈጥሮታል
  }
  return Game.findOne({ roomCode }).select(LIGHT_SELECT).lean();
}

/** ሰርቨር ሲነሳ ብቻ — የ 1250 ካርዶች ስብስብ ሙሉ መሆኑን ያረጋግጣል */
async function ensureRoomCards(roomCode) {
  const g = await Game.findOne({ roomCode }).select("allCards").lean();
  if (g && (!g.allCards || g.allCards.length < TOTAL_CARDS)) {
    await Game.updateOne(
      { roomCode },
      { $set: { allCards: generate1250Cards() } }
    );
  }
}

// ═══════════════════════════════════════════════════════
// 👈 resetToWaiting — LIGHT_SELECT ይመልሳል
//     (ከዚህ በፊት allCards ሙሉ ተመልሶ ~200KB በ socket ይላክ ነበር)
// ═══════════════════════════════════════════════════════
async function resetToWaiting(roomCode) {
  const current = await Game.findOne({ roomCode }).select("entryFee").lean();
  const fee = current?.entryFee || feeForRoom(roomCode);

  // 👈 LIGHT_SELECT + lean → socket emit ሲደረግ ቀላል ነው
  return Game.findOneAndUpdate(
    { roomCode },
    { $set: waitingFields(roomCode, fee) },
    { new: true, projection: LIGHT_SELECT, lean: true }
  );
}

// ═══════════════════════════════════════════════════════
// 👈 publicState — የተስተካከለ
//     ቀድሞ: playerCount እና totalCards በምርጫ ወቅት 0 ነበሩ (players ባዶ ስለሆነ)
//     አሁን: reservedCards + players ሁለቱንም ይቆጥራል
//     ተጨማሪ: takenCards አንድ ላይ ተጣምሯል (reservedCards field ጠፍቷል)
//     ተጨማሪ: serverTime ISO string ጠፍቷል (serverNow number በቂ ነው)
// ═══════════════════════════════════════════════════════
function publicState(game) {
  const deadline =
    game.isWeeklyGame && game.scheduledStart
      ? game.scheduledStart
      : game.selectionEndsAt;
  const now = Date.now();

  // 👈 ከሁለቱም players + reservedCards ይቁጠራል
  const uniqueUserIds = new Set();
  const takenCards = [];

  // ጨዋታ ንቁ ሲሆን players ይኖራል
  if (game.players?.length) {
    for (const p of game.players) {
      const key = String(p.user || p.telegramId || "");
      if (key) uniqueUserIds.add(key);
      if (p.cardId) takenCards.push(p.cardId);
    }
  }

  // በምርጫ ወቅት reservedCards ይኖራል
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
    // 👈 አሁን ትክክል ነው
    playerCount: uniqueUserIds.size,
    totalCards: takenCards.length,
    // 👈 takenCards አንድ ላይ (reservedCards + players)
    takenCards,
    calledNumbers: game.calledNumbers || [],
    maxNumber: game.maxNumber,
    winPattern: game.winPattern || "any-row",
    isWeeklyGame: !!game.isWeeklyGame,
    selectionEndsAt: game.status === "waiting" && deadline ? deadline : null,
    scheduledStart: game.scheduledStart || null,
    // 👈 serverNow number ብቻ (serverTime ISO string ጠፍቷል — bandwidth)
    serverNow: now,
    remainingMs,
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