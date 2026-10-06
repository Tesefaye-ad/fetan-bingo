// ═══════════════════════════════════════════════════════
// ROOMS SERVICE — ለ REST እና ለ Socket የሚጋራ የክፍል አስተዳደር
// ═══════════════════════════════════════════════════════
const Game = require("../models/Game");
const {
  generate1250Cards,
  getPatternForRoom,
  TOTAL_CARDS,
} = require("../utils/bingoCard");
const {
  getNextDailyStart,
  isWeeklyRoom,
  getWeeklyFee,
} = require("../utils/schedule");

const SELECTION_TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);
const MAX_NUMBER = 75;
const DEFAULT_ROOMS = ["ROOM10", "ROOM20", "ROOM50", "ROOM100"];

/** የሚታወቁ ክፍሎች ብቻ ይፈቀዳሉ (ማንም በዘፈቀደ ክፍል እንዳይፈጥር) */
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
  return {
    status: "waiting",
    entryFee: fee,
    isWeeklyGame: weekly,
    winPattern: getPatternForRoom(fee),
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

/** ክፍሉን ወደ አዲስ "waiting" ዙር ይመልሳል (አዲስ ሰዓት ቆጣሪ ወይም የነገ መጀመሪያ ሰዓት) */
async function resetToWaiting(roomCode) {
  const current = await Game.findOne({ roomCode }).select("entryFee");
  const fee = current?.entryFee || feeForRoom(roomCode);
  return Game.findOneAndUpdate(
    { roomCode },
    { $set: waitingFields(roomCode, fee) },
    { new: true }
  );
}

/** ለ client የሚላክ የክፍል ሁኔታ. ሰዓቱ ሁልጊዜ በ absolute ISO + serverTime ይላካል. */
function publicState(game) {
  const deadline =
    game.isWeeklyGame && game.scheduledStart
      ? game.scheduledStart
      : game.selectionEndsAt;
  const now = Date.now();
  return {
    roomCode: game.roomCode,
    status: game.status,
    entryFee: game.entryFee,
    prizePool: game.prizePool,
    playerCount: game.players.length,
    calledNumbers: game.calledNumbers,
    maxNumber: game.maxNumber,
    takenCards: game.players.map((p) => p.cardId),
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
  normalizeRoomCode,
  feeForRoom,
  waitingFields,
  LIGHT_SELECT,
  ensureRoom,
  ensureRoomCards,
  resetToWaiting,
  publicState,
};
