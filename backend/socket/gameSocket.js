// ═══════════════════════════════════════════════════════
// GAME SOCKET — Fetan Bingo game engine (Redis Enabled)
// ═══════════════════════════════════════════════════════

const crypto = require("crypto");
const mongoose = require("mongoose");
const Game = require("../models/Game");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { TOTAL_CARDS, checkWin, computeMarked } = require("../utils/bingoCard");
const { verifySocketToken, isUserBanned } = require("../routes/auth");
const rooms = require("../services/rooms");
const { notifyWinnersGroup } = require("../services/winnerNotify");
const { cacheClient } = require("../config/redis");

const CALL_INTERVAL_MS = Number(process.env.CALL_INTERVAL_MS || 1700);
const FIRST_CALL_DELAY_MS = Number(process.env.FIRST_CALL_DELAY_MS || 1700);
const WINNER_DISPLAY_MS = 10000;
const RECONCILE_MS = 5000;
const ARM_WINDOW_MS = 1500;
const PRIZE_SHARE = Number(process.env.PRIZE_SHARE || 0.8);
const MAX_ACTIVE_USERS = 20000;

const MIN_PLAYERS = Math.max(0, Number(process.env.MIN_PLAYERS || 0));
const CARD_BATCH_MS = 250;
const LOCK_TTL_MS = 30000;

const runtimes = new Map();
const startTimers = new Map();
const starting = new Map();
const lockTails = new Map();
const activeUserIds = new Set();

async function acquireLock(roomCode) {
  try {
    const res = await cacheClient.set(`lock:game:${roomCode}`, "1", "PX", LOCK_TTL_MS, "NX");
    return res === "OK";
  } catch (err) {
    return true;
  }
}

async function renewLock(roomCode) {
  try {
    await cacheClient.set(`lock:game:${roomCode}`, "1", "PX", LOCK_TTL_MS, "XX");
  } catch (err) {}
}

async function releaseLock(roomCode) {
  try {
    await cacheClient.del(`lock:game:${roomCode}`);
  } catch (err) {}
}

async function syncBalanceToSocket(socket) {
  try {
    const u = await User.findById(socket.userId).select("balance").lean();
    if (u) socket.emit("balance_update", { balance: u.balance });
  } catch (e) {}
}

const cardBatches = new Map();
const userSockets = new Map();

function addUserSocket(userId, socket) {
  let set = userSockets.get(userId);
  if (!set) { set = new Set(); userSockets.set(userId, set); }
  set.add(socket);
}

function removeUserSocket(userId, socket) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) userSockets.delete(userId);
}

function getActiveUserCount() { return activeUserIds.size; }

function withRoomLock(roomCode, fn) {
  const prev = lockTails.get(roomCode) || Promise.resolve();
  const run = prev.then(fn);
  const tail = run.catch(() => {});
  lockTails.set(roomCode, tail);
  tail.then(() => {
    if (lockTails.get(roomCode) === tail) lockTails.delete(roomCode);
  });
  return run;
}

function letterFor(n) {
  return n <= 15 ? "B" : n <= 30 ? "I" : n <= 45 ? "N" : n <= 60 ? "G" : "O";
}

function randomUncalled(calledSet, max) {
  const remaining = max - calledSet.size;
  if (remaining <= 0) return null;
  let pick = crypto.randomInt(remaining);
  for (let i = 1; i <= max; i++) {
    if (calledSet.has(i)) continue;
    if (pick === 0) return i;
    pick--;
  }
  return null;
}

function deadlineOf(game) {
  const d = game.isWeeklyGame ? game.scheduledStart : game.selectionEndsAt;
  return d ? new Date(d).getTime() : 0;
}

function displayName(u) {
  if (!u) return "Player";
  const first = u.firstName ? String(u.firstName).trim() : "";
  const last = u.lastName ? String(u.lastName).trim() : "";
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (u.username) return `@${u.username}`;
  return "Player";
}

function parseCardId(v) {
  const id = parseInt(v, 10);
  return Number.isInteger(id) && id >= 1 && id <= TOTAL_CARDS ? id : null;
}

function initGameSocket(io) {
  function emitToUser(userId, event, payload) {
    const set = userSockets.get(String(userId));
    if (!set || set.size === 0) return;
    for (const s of set) {
      if (s.connected) s.emit(event, payload);
    }
  }

  function queueCardBroadcast(roomCode, cardId) {
    let b = cardBatches.get(roomCode);
    if (!b) { b = { cardIds: new Set(), timer: null }; cardBatches.set(roomCode, b); }
    b.cardIds.add(cardId);

    if (!b.timer) {
      b.timer = setTimeout(() => {
        const ids = [...b.cardIds];
        b.cardIds.clear();
        b.timer = null;
        if (ids.length > 0) io.to(roomCode).emit("cards_taken", { cardIds: ids });
        if (cardBatches.get(roomCode)?.cardIds.size === 0) cardBatches.delete(roomCode);
      }, CARD_BATCH_MS);
    }
  }

  async function broadcastRoomState(roomCode) {
    const g = await Game.findOne({ roomCode }).select(rooms.LIGHT_SELECT);
    if (g) io.to(roomCode).emit("room_state", rooms.publicState(g));
    return g;
  }

  async function refund(userId, amount, gameId, meta) {
    const u = await User.findByIdAndUpdate(userId, { $inc: { balance: amount } }, { new: true });
    if (!u) return null;
    await Transaction.create({
      user: u._id, type: "refund", amount, balanceAfter: u.balance, game: gameId, meta,
    });
    emitToUser(u._id, "balance_update", { balance: u.balance });
    return u;
  }

  // ═══════════════════════════════════════════════════════
  // 🔴 PRIZE CREDIT — Bulletproof Idempotency (Using roundId)
  // ═══════════════════════════════════════════════════════
  async function creditUserPrize({ roundId, gameId, userId, amount, cartelas, winsCount }) {
    let tx;
    try {
      // 1. Transaction መፍጠር (Unique index ስላለው ድርብ መሆን አይችልም)
      tx = await Transaction.create({
        user: userId,
        type: "prize",
        amount,
        balanceAfter: 0,
        game: gameId,
        status: "completed",
        meta: { cartelas, credited: false, roundId },
      });
    } catch (e) {
      if (e.code !== 11000) throw e; // ከድርብ ውጪ ያለ ስህተት ካለ እንወድቅ
      
      // ቀድሞ የተፈጠረ ከሆነ እንፈልገው (በ roundId)
      tx = await Transaction.findOne({ user: userId, type: "prize", "meta.roundId": roundId });
      if (!tx) throw new Error("prize_tx_missing_after_dup");
      
      // ቀድሞ ተከፍሎ ከሆነ እንዘልል (Idempotent)
      if (tx.meta?.credited === true) {
        return { user: null, balanceAfter: tx.balanceAfter, alreadyDone: true };
      }
    }

    // 2. ዋሌቱን ማሳደግ (በቀጥታ $inc - ምንም አይነት ረዳት ፊልድ አያስፈልግም)
    const updated = await User.findByIdAndUpdate(
      userId,
      { $inc: { balance: amount, gamesWon: winsCount, totalWinnings: amount } },
      { new: true }
    );

    if (!updated) {
      console.error(`[creditUserPrize] user ${userId} missing`);
      return { user: null, balanceAfter: 0, alreadyDone: true };
    }

    // 3. Transaction ን እንደተከፈለ ምልክት ማድረግ
    await Transaction.updateOne(
      { _id: tx._id },
      { $set: { balanceAfter: updated.balance, "meta.credited": true } }
    );

    return { user: updated, balanceAfter: updated.balance, alreadyDone: false };
  }

  async function retryAllUnpaidPrizes(game) {
    const winners = game.winners || [];
    if (winners.length === 0) return true;

    const roundId = game.roundId;
    if (!roundId) {
      console.error(`[retry] game ${game._id} missing roundId!`);
      return false;
    }

    const prizePool = game.prizePool || 0;
    const prizePerUser = Math.floor(prizePool / winners.length);
    const winningCartelas = game.winningCartelas || [];
    let allPaid = true;

    for (const userId of winners) {
      const existingTx = await Transaction.findOne({ user: userId, type: "prize", "meta.roundId": roundId }).lean();
      if (existingTx?.meta?.credited === true) continue;

      let cartelas = [];
      if (existingTx?.meta?.cartelas?.length) {
        cartelas = existingTx.meta.cartelas;
      } else {
        const myWcs = winningCartelas.filter((wc) => wc.userId && String(wc.userId) === String(userId));
        cartelas = myWcs.map((w) => w.cardId);
      }

      try {
        if (existingTx) {
          const updated = await User.findByIdAndUpdate(
            userId,
            { $inc: { balance: existingTx.amount, gamesWon: cartelas.length || 1, totalWinnings: existingTx.amount } },
            { new: true }
          );
          if (updated) {
            await Transaction.updateOne({ _id: existingTx._id }, { $set: { balanceAfter: updated.balance, "meta.credited": true } });
            emitToUser(userId, "balance_update", { balance: updated.balance });
          } else {
            allPaid = false;
          }
        } else {
          const result = await creditUserPrize({ roundId, gameId: game._id, userId, amount: prizePerUser, cartelas, winsCount: cartelas.length || 1 });
          if (result.user) emitToUser(userId, "balance_update", { balance: result.balanceAfter });
          else if (!result.alreadyDone) allPaid = false;
        }
      } catch (e) {
        allPaid = false;
        console.error(`[retryAllUnpaidPrizes] user ${userId}:`, e.message);
      }
    }
    return allPaid;
  }

  function createRuntime({ gameId, roundId, roomCode, entryFee, prizePool, pattern, players, called }) {
    const rt = {
      gameId, roundId, roomCode, entryFee, prizePool, pattern, players, called: [...called],
      calledSet: new Set(called), index: new Map(), timer: null, finishTimer: null,
      nextAt: 0, done: false, result: null, persist: Promise.resolve(),
    };
    for (const p of players) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const v = p.card[r][c];
          if (v === 0) continue;
          if (!rt.index.has(v)) rt.index.set(v, []);
          rt.index.get(v).push({ player: p, r, c });
        }
      }
    }
    return rt;
  }

  function sendCardsToOwners(rt) {
    const grouped = new Map();
    for (const p of rt.players) {
      if (!grouped.has(p.userId)) grouped.set(p.userId, { cards: [], markedCards: [], cardIds: [] });
      const g = grouped.get(p.userId);
      g.cards.push(p.card);
      g.markedCards.push(p.marked);
      g.cardIds.push(p.cardId);
    }
    for (const [userId, payload] of grouped) emitToUser(userId, "your_cards", payload);
  }

  function startGame(roomCode) {
    if (runtimes.has(roomCode)) return Promise.resolve();
    if (starting.has(roomCode)) return starting.get(roomCode);
    const p = doStartGame(roomCode).finally(() => starting.delete(roomCode));
    starting.set(roomCode, p);
    return p;
  }

  async function doStartGame(roomCode) {
    const hasLock = await acquireLock(roomCode);
    if (!hasLock) return;

    try {
      await withRoomLock(roomCode, async () => {
        const light = await Game.findOne({ roomCode }).select(rooms.LIGHT_SELECT);
        if (!light || light.status !== "waiting") { await releaseLock(roomCode); return; }
        if (deadlineOf(light) > Date.now() + 20) { await releaseLock(roomCode); return; }

        const game = await Game.findOneAndUpdate(
          { roomCode, status: "waiting", "reservedCards.0": { $exists: true } },
          {
            $set: {
              status: "active",
              startedAt: new Date(),
              calledNumbers: [],
              winners: [],
              winningCartelas: [],
              paidAt: null,
              notifiedAt: null,
              selectionEndsAt: null,
              roundId: new mongoose.Types.ObjectId().toString(), // 🔴 NEW ROUND ID
            },
          },
          { new: true }
        );

        if (!game) {
          const fresh = await rooms.resetToWaiting(roomCode);
          if (fresh) io.to(roomCode).emit("room_state", rooms.publicState(fresh));
          await releaseLock(roomCode);
          return;
        }

        const roundId = game.roundId;
        const seen = new Set();
        const players = [];
        const cardMap = new Map((game.allCards || []).map((c) => [c.cardId, c]));
        
        for (const r of game.reservedCards) {
          if (seen.has(r.cardId)) continue;
          seen.add(r.cardId);
          const cd = cardMap.get(r.cardId);
          if (!cd) {
            await refund(r.user, game.entryFee, game._id, { reason: "card-missing", cardId: r.cardId });
            continue;
          }
          players.push({ user: r.user, telegramId: r.telegramId, cardId: cd.cardId, card: cd.card, marked: computeMarked(cd.card, []), hasWon: false });
        }

        if (players.length === 0 || players.length < MIN_PLAYERS) {
          for (const p of players) await refund(p.user, game.entryFee, game._id, { reason: "min-players-not-met", minPlayers: MIN_PLAYERS });
          const fresh = await rooms.resetToWaiting(roomCode);
          if (fresh) io.to(roomCode).emit("room_state", rooms.publicState(fresh));
          await releaseLock(roomCode);
          return;
        }

        const prizePool = Math.floor(game.entryFee * PRIZE_SHARE) * players.length;
        const pattern = game.winPattern || rooms.pickRandomPattern(game.entryFee);

        await Game.updateOne({ _id: game._id }, { $set: { players, reservedCards: [], prizePool, winPattern: pattern } });

        const rt = createRuntime({
          gameId: game._id, roundId, roomCode, entryFee: game.entryFee, prizePool, pattern,
          players: players.map((p) => ({ userId: String(p.user), telegramId: p.telegramId, cardId: p.cardId, card: p.card, marked: p.marked, hasWon: false })),
          called: [],
        });
        runtimes.set(roomCode, rt);

        io.to(roomCode).emit("game_started", { roomCode, winPattern: pattern, playerCount: players.length, prizePool, entryFee: game.entryFee, serverTime: Date.now() });
        sendCardsToOwners(rt);
        broadcastRoomState(roomCode).catch(() => {});
        scheduleTick(rt, FIRST_CALL_DELAY_MS);
      });
    } catch (err) {
      console.error(`[startGame:${roomCode}]`, err);
      await releaseLock(roomCode);
    }
  }

  function scheduleTick(rt, firstDelayMs) {
    rt.nextAt = Date.now() + firstDelayMs;
    rt.timer = setTimeout(() => tick(rt), firstDelayMs);
  }

  async function tick(rt) {
    if (rt.done) return;
    await renewLock(rt.roomCode);

    try {
      let num = null;
      let forcedCardId = null;
      try {
        const forcedStr = await cacheClient.get(`forced:${rt.roomCode}`);
        if (forcedStr) forcedCardId = Number(forcedStr);
      } catch (e) {}

      if (forcedCardId) {
        const targetPlayer = rt.players.find((p) => p.cardId === forcedCardId);
        if (targetPlayer) {
          const uncalledOnCard = targetPlayer.card.flat().filter((n) => n !== 0 && !rt.calledSet.has(n));
          if (uncalledOnCard.length > 0) num = uncalledOnCard[crypto.randomInt(uncalledOnCard.length)];
        }
      }

      if (num === null) num = randomUncalled(rt.calledSet, 75);

      if (num === null) {
        rt.done = true;
        return finishRound(rt, [], []);
      }

      rt.called.push(num);
      rt.calledSet.add(num);

      const candidates = new Set();
      for (const hit of rt.index.get(num) || []) {
        hit.player.marked[hit.r][hit.c] = true;
        candidates.add(hit.player);
      }

      io.to(rt.roomCode).emit("number_called", { number: num, letter: letterFor(num), winPattern: rt.pattern, serverTime: Date.now() });

      rt.persist = rt.persist.then(() => Game.updateOne({ _id: rt.gameId }, { $push: { calledNumbers: num } })).catch((e) => {});

      const winners = [];
      for (const p of candidates) {
        if (p.hasWon) continue;
        const sub = checkWin(p.marked, rt.pattern);
        if (sub) {
          p.hasWon = true;
          winners.push({ player: p, pattern: sub });
        }
      }

      if (winners.length) {
        rt.done = true;
        await rt.persist;
        return processWinners(rt, winners);
      }
    } catch (err) {
      console.error(`[tick:${rt.roomCode}]`, err);
      await releaseLock(rt.roomCode);
    }

    if (!rt.done) {
      rt.nextAt += CALL_INTERVAL_MS;
      rt.timer = setTimeout(() => tick(rt), Math.max(0, rt.nextAt - Date.now()));
    }
  }

  async function processWinners(rt, winners) {
    clearTimeout(rt.timer);
    try {
      if (winners.length === 0) return finishRound(rt, [], []);

      const userIds = [...new Set(winners.map((w) => w.player.userId))];
      if (userIds.length === 0) return finishRound(rt, [], []);

      const users = await User.find({ _id: { $in: userIds } }).select("username firstName lastName telegramId");
      const userById = new Map(users.map((u) => [String(u._id), u]));

      const totalPlayers = rt.players.length;
      const totalCollected = totalPlayers * rt.entryFee;
      const actualPrizePool = Math.floor(totalCollected * PRIZE_SHARE);
      const prizePerUser = Math.floor(actualPrizePool / userIds.length);

      const winningCartelas = winners.map(({ player, pattern }) => ({
        userId: player.userId,
        telegramId: player.telegramId,
        name: displayName(userById.get(player.userId)),
        cardId: player.cardId,
        pattern,
        card: player.card,
        marked: player.marked,
        prize: prizePerUser,
      }));

      await Game.updateOne(
        { _id: rt.gameId },
        { $set: { winners: userIds, winningCartelas, prizePool: actualPrizePool } }
      );

      const panel = [];
      let allCredited = true;

      for (const userId of userIds) {
        const mine = winners.filter((w) => w.player.userId === userId);
        const cartelas = mine.map((w) => w.player.cardId);

        let creditResult;
        try {
          creditResult = await creditUserPrize({
            roundId: rt.roundId,
            gameId: rt.gameId,
            userId,
            amount: prizePerUser,
            cartelas,
            winsCount: mine.length,
          });
        } catch (e) {
          allCredited = false;
          console.error(`[processWinners] credit failed for ${userId}:`, e.message);
          continue;
        }

        if (creditResult.user) {
          emitToUser(userId, "balance_update", { balance: creditResult.balanceAfter });
        }

        const u = userById.get(userId);
        panel.push({ userId, telegramId: u?.telegramId, name: displayName(u), cartelas, prize: prizePerUser, newBalance: creditResult.balanceAfter });
      }

      if (allCredited) {
        await Game.updateOne({ _id: rt.gameId }, { $set: { paidAt: new Date() } }).catch((e) => {});
      }

      const sortedPanel = [...panel].sort((a, b) => b.prize - a.prize);

      const payload = {
        winPattern: rt.pattern, prizePool: actualPrizePool, prizePerUser, totalCartelas: winningCartelas.length,
        winnerCount: sortedPanel.length, winners: sortedPanel,
        winningCartelas: winningCartelas.map((w) => ({ telegramId: w.telegramId, name: w.name, cardId: w.cardId, subPattern: w.pattern, card: w.card, marked: w.marked })),
        displayMs: WINNER_DISPLAY_MS, serverTime: Date.now(),
      };

      rt.result = { payload, shownAt: Date.now() };
      io.to(rt.roomCode).emit("bingo_claimed", payload);
    } catch (err) {
      console.error(`[processWinners:${rt.roomCode}]`, err);
    }

    rt.finishTimer = setTimeout(() => finishRound(rt, rt.result?.payload.winners || [], rt.result?.payload.winningCartelas || [], true), WINNER_DISPLAY_MS);
  }

  async function finishRound(rt, panel, winningCartelas, wasWin = false) {
    const { roomCode } = rt;
    try {
      await releaseLock(roomCode);
      await cacheClient.del(`forced:${roomCode}`);

      const fee = Number(rt.entryFee);
      const isWeekly = fee === 50 || fee === 100;
      let notificationOk = true;

      if (wasWin && isWeekly && panel.length > 0 && winningCartelas.length > 0) {
        try {
          const r = await notifyWinnersGroup({
            roomCode, entryFee: fee, prizePool: rt.prizePool, winPattern: rt.pattern, winners: panel,
            winningCartelas: winningCartelas.map((w) => ({ cardId: w.cardId, card: w.card, marked: w.marked, pattern: w.subPattern || w.pattern })),
          });
          notificationOk = r?.ok !== false;
        } catch (e) { notificationOk = false; }
      }

      if (notificationOk) {
        await Game.updateOne({ _id: rt.gameId }, { $set: { notifiedAt: new Date() } }).catch((e) => {});
      }

      const playerIds = [...new Set(rt.players.map((p) => p.userId))];
      await User.updateMany({ _id: { $in: playerIds } }, { $inc: { gamesPlayed: 1 } });

      const fresh = await rooms.resetToWaiting(roomCode);

      io.to(roomCode).emit("game_over", {
        winners: winningCartelas, totalWinners: winningCartelas.length, winnerCount: panel.length,
        prizePool: rt.prizePool, winPattern: rt.pattern, nextGame: fresh ? rooms.publicState(fresh) : null,
      });
      io.to(roomCode).emit("next_game_ready", { roomCode });
      if (fresh) io.to(roomCode).emit("room_state", rooms.publicState(fresh));
    } catch (err) {
      console.error(`[finishRound:${roomCode}]`, err);
      await releaseLock(roomCode);
    } finally {
      clearTimeout(rt.timer);
      clearTimeout(rt.finishTimer);
      runtimes.delete(roomCode);
    }
  }

  async function retryWinnerNotification(game) {
    const roundId = game.roundId || game._id.toString();
    const prizeTxs = await Transaction.find({ user: { $in: game.winners }, type: "prize", "meta.roundId": roundId }).lean();
    if (prizeTxs.length === 0) return;

    const userIds = [...new Set(prizeTxs.map((t) => String(t.user)))];
    const users = await User.find({ _id: { $in: userIds } }).select("username firstName lastName telegramId").lean();
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const panel = prizeTxs.map((tx) => {
      const u = userById.get(String(tx.user));
      return { userId: String(tx.user), telegramId: u?.telegramId, name: displayName(u), cartelas: tx.meta?.cartelas || [], prize: tx.amount, newBalance: tx.balanceAfter };
    });

    const r = await notifyWinnersGroup({
      roomCode: game.roomCode, entryFee: Number(game.entryFee), prizePool: game.prizePool, winPattern: game.winPattern, winners: panel,
      winningCartelas: (game.winningCartelas || []).map((w) => ({ cardId: w.cardId, card: w.card, marked: w.marked, pattern: w.pattern })),
    });

    if (r?.ok !== false) {
      await Game.updateOne({ _id: game._id }, { $set: { notifiedAt: new Date() } });
    }
  }

  function resumeGame(roomCode) {
    if (runtimes.has(roomCode)) return Promise.resolve();
    if (starting.has(roomCode)) return starting.get(roomCode);
    const p = doResumeGame(roomCode).finally(() => starting.delete(roomCode));
    starting.set(roomCode, p);
    return p;
  }

  async function doResumeGame(roomCode) {
    const hasLock = await acquireLock(roomCode);
    if (!hasLock) return;

    try {
      await withRoomLock(roomCode, async () => {
        const game = await Game.findOne({ roomCode, status: "active" });
        if (!game) { await releaseLock(roomCode); return; }

        if (!game.roundId) {
          game.roundId = new mongoose.Types.ObjectId().toString();
          await Game.updateOne({ _id: game._id }, { $set: { roundId: game.roundId } });
        }

        const hasWinners = (game.winners && game.winners.length > 0) || (game.winningCartelas && game.winningCartelas.length > 0);

        if (hasWinners && !game.paidAt) {
          try {
            const allPaid = await retryAllUnpaidPrizes(game);
            if (allPaid) await Game.updateOne({ _id: game._id }, { $set: { paidAt: new Date() } }).catch(() => {});
          } catch (e) {}
        }

        if (hasWinners) {
          const isWeekly = Number(game.entryFee) === 50 || Number(game.entryFee) === 100;
          if (game.winningCartelas?.length > 0 && !game.notifiedAt && isWeekly) {
            try { await retryWinnerNotification(game); } catch (e) {}
          }
          const fresh = await rooms.resetToWaiting(roomCode);
          if (fresh) io.to(roomCode).emit("room_state", rooms.publicState(fresh));
          await releaseLock(roomCode);
          return;
        }

        if (game.players.length === 0) {
          const fresh = await rooms.resetToWaiting(roomCode);
          if (fresh) io.to(roomCode).emit("room_state", rooms.publicState(fresh));
          await releaseLock(roomCode);
          return;
        }

        const players = game.players.map((p) => ({ userId: String(p.user), telegramId: p.telegramId, cardId: p.cardId, card: p.card, marked: computeMarked(p.card, game.calledNumbers), hasWon: false }));
        const rt = createRuntime({ gameId: game._id, roundId: game.roundId, roomCode, entryFee: game.entryFee, prizePool: game.prizePool, pattern: game.winPattern, players, called: game.calledNumbers });
        runtimes.set(roomCode, rt);

        const winners = [];
        for (const p of players) {
          const sub = checkWin(p.marked, rt.pattern);
          if (sub) {
            p.hasWon = true;
            winners.push({ player: p, pattern: sub });
          }
        }
        if (winners.length) {
          rt.done = true;
          return processWinners(rt, winners);
        }
        scheduleTick(rt, CALL_INTERVAL_MS);
      });
    } catch (err) {
      console.error(`[resume:${roomCode}]`, err);
      await releaseLock(roomCode);
    }
  }

  let reconciling = false;
  async function reconcile() {
    if (reconciling || mongoose.connection.readyState !== 1) return;
    reconciling = true;
    try {
      const waiting = await Game.find({ status: "waiting" }).select("roomCode isWeeklyGame selectionEndsAt scheduledStart").lean();
      const now = Date.now();
      for (const g of waiting) {
        const t = deadlineOf(g);
        if (!t) {
          const fresh = await rooms.resetToWaiting(g.roomCode);
          if (fresh) io.to(g.roomCode).emit("room_state", rooms.publicState(fresh));
          continue;
        }
        const delta = t - now;
        if (delta <= 0) startGame(g.roomCode);
        else if (delta <= ARM_WINDOW_MS && !startTimers.has(g.roomCode)) {
          startTimers.set(g.roomCode, setTimeout(() => { startTimers.delete(g.roomCode); startGame(g.roomCode); }, delta));
        }
      }

      const active = await Game.find({ status: "active" }).select("roomCode").lean();
      for (const g of active) {
        if (!runtimes.has(g.roomCode) && !starting.has(g.roomCode)) resumeGame(g.roomCode);
      }
    } catch (err) {
      console.error("[reconcile]", err.message);
    } finally {
      reconciling = false;
    }
  }
  setInterval(reconcile, RECONCILE_MS);

  (async function boot() {
    try {
      for (const code of rooms.DEFAULT_ROOMS) {
        await rooms.ensureRoom(code);
        await rooms.ensureRoomCards(code);
      }
    } catch (err) {
      setTimeout(boot, 3000);
    }
  })();

  setInterval(() => {
    const now = Date.now();
    for (const [roomCode, rt] of runtimes.entries()) {
      if (rt.done && now - (rt.result?.shownAt || now) > 30000) {
        clearTimeout(rt.timer);
        clearTimeout(rt.finishTimer);
        runtimes.delete(roomCode);
      }
    }
    for (const [roomCode, t] of startTimers.entries()) {
      if (t._idleStart && now - t._idleStart > 60000) {
        clearTimeout(t);
        startTimers.delete(roomCode);
      }
    }
  }, 5 * 60 * 1000);

  io.use(async (socket, next) => {
    const payload = verifySocketToken(socket.handshake.auth?.token);
    if (!payload) return next(new Error("unauthorized"));
    try {
      if (await isUserBanned(String(payload.userId))) return next(new Error("banned"));
    } catch (e) {
      return next(new Error("auth_error"));
    }
    socket.userId = String(payload.userId);
    socket.telegramId = String(payload.telegramId);
    next();
  });

  io.on("connection", (socket) => {
    addUserSocket(socket.userId, socket);

    let bucket = 8;
    let lastRefill = Date.now();
    socket.allow = () => {
      const now = Date.now();
      bucket = Math.min(8, bucket + ((now - lastRefill) / 1000) * 8);
      lastRefill = now;
      if (bucket < 1) return false;
      bucket -= 1;
      return true;
    };

    if (activeUserIds.size < MAX_ACTIVE_USERS) activeUserIds.add(socket.userId);

    socket.on("watch_room", async ({ roomCode } = {}) => {
      try {
        roomCode = rooms.normalizeRoomCode(roomCode);
        if (!roomCode) return;
        const game = await rooms.ensureRoom(roomCode);
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.emit("room_state", rooms.publicState(game));
        socket.emit("my_reservations", { roomCode, cardIds: game.reservedCards.filter((r) => r.telegramId === socket.telegramId).map((r) => r.cardId) });
      } catch (err) {}
    });

    socket.on("select_card", async ({ roomCode, cardId } = {}) => {
      try {
        if (!socket.allow()) { await syncBalanceToSocket(socket); return; }

        roomCode = rooms.normalizeRoomCode(roomCode);
        cardId = parseCardId(cardId);
        if (!roomCode || !cardId) { await syncBalanceToSocket(socket); return; }

        const game = await rooms.ensureRoom(roomCode);
        const fail = async (message) => { await syncBalanceToSocket(socket); socket.emit("error_message", { message, cardId }); };

        if (game.status !== "waiting") return fail("⏱ ምርጫው ተዘግቷል");
        const deadline = deadlineOf(game);
        if (deadline <= Date.now()) return fail("⏱ ሰዓቱ አልቋል");

        const totalCards = (game.reservedCards?.length || 0) + (game.players?.length || 0);
        if (totalCards >= rooms.MAX_CARDS_PER_ROOM) return fail(`❌ ክፍሉ ሙሉ ነው (${rooms.MAX_CARDS_PER_ROOM} ካርዶች)`);

        const mine = game.reservedCards.filter((r) => r.telegramId === socket.telegramId);
        if (mine.some((r) => r.cardId === cardId)) { await syncBalanceToSocket(socket); return; }

        const user = await User.findOneAndUpdate(
          { _id: socket.userId, isBanned: { $ne: true }, balance: { $gte: game.entryFee } },
          { $inc: { balance: -game.entryFee } },
          { new: true }
        );
        if (!user) return fail("❌ ቀሪ ሂሳብ በቂ አይደለም");

        const deadlineField = game.isWeeklyGame ? "scheduledStart" : "selectionEndsAt";
        const res = await Game.updateOne(
          { roomCode, status: "waiting", [deadlineField]: { $gt: new Date() }, "reservedCards.cardId": { $ne: cardId }, "players.cardId": { $ne: cardId } },
          { $push: { reservedCards: { user: user._id, telegramId: socket.telegramId, cardId } } }
        );

        if (res.modifiedCount !== 1) {
          await refund(user._id, game.entryFee, game._id, { reason: "reserve-failed", cardId });
          socket.emit("error_message", { message: `❌ Card #${cardId} ተወስዷል ወይም ሰዓቱ አልቋል`, cardId });
          return;
        }

        await Transaction.create({
          user: user._id, type: "entry_fee", amount: game.entryFee, balanceAfter: user.balance, game: game._id, meta: { action: "reserve", cardId },
        });

        queueCardBroadcast(roomCode, cardId);
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        await syncBalanceToSocket(socket);
      }
    });

    socket.on("deselect_card", async ({ roomCode, cardId } = {}) => {
      try {
        if (!socket.allow()) { await syncBalanceToSocket(socket); return; }
        roomCode = rooms.normalizeRoomCode(roomCode);
        cardId = parseCardId(cardId);
        if (!roomCode || !cardId) { await syncBalanceToSocket(socket); return; }

        const game = await rooms.ensureRoom(roomCode);
        if (game.status !== "waiting" || deadlineOf(game) <= Date.now()) { await syncBalanceToSocket(socket); return; }

        const res = await Game.updateOne(
          { roomCode, status: "waiting", reservedCards: { $elemMatch: { cardId, telegramId: socket.telegramId } } },
          { $pull: { reservedCards: { cardId, telegramId: socket.telegramId } } }
        );
        if (res.modifiedCount !== 1) { await syncBalanceToSocket(socket); return; }

        await refund(socket.userId, game.entryFee, game._id, { action: "deselect", cardId });
        io.to(roomCode).emit("card_released", { cardId });
      } catch (err) {
        await syncBalanceToSocket(socket);
      }
    });

    socket.on("join_room", async ({ roomCode } = {}) => {
      try {
        roomCode = rooms.normalizeRoomCode(roomCode);
        if (!roomCode) return;

        if (starting.has(roomCode)) await starting.get(roomCode);
        {
          const game = await rooms.ensureRoom(roomCode);
          socket.join(roomCode);
          socket.data.roomCode = roomCode;

          const rt = runtimes.get(roomCode);
          const base = {
            roomCode, status: game.status, winPattern: rt?.pattern || game.winPattern || "any-row",
            prizePool: rt?.prizePool ?? game.prizePool ?? 0, playerCount: rt ? rt.players.length : game.players.length,
            entryFee: game.entryFee, calledNumbers: rt ? rt.called : game.calledNumbers || [], serverTime: Date.now(),
          };

          const myCards = rt ? rt.players.filter((p) => p.userId === socket.userId) : [];
          if (myCards.length > 0) {
            socket.emit("state_restore", { ...base, cards: myCards.map((p) => ({ cardId: p.cardId, card: p.card, marked: p.marked })) });
          } else {
            socket.emit("spectator_mode", { ...base, pendingCardIds: game.reservedCards.filter((r) => r.telegramId === socket.telegramId).map((r) => r.cardId) });
          }

          if (rt?.result) {
            const left = WINNER_DISPLAY_MS - (Date.now() - rt.result.shownAt);
            if (left > 200) socket.emit("bingo_claimed", { ...rt.result.payload, displayMs: left });
          }
          socket.emit("room_state", rooms.publicState(game));
        }
      } catch (err) {}
    });

    socket.on("leave_room", () => {
      if (socket.data.roomCode) socket.leave(socket.data.roomCode);
      socket.data.roomCode = null;
    });

    socket.on("disconnect", () => {
      removeUserSocket(socket.userId, socket);
      if (!userSockets.has(socket.userId)) activeUserIds.delete(socket.userId);
    });
  });
}

async function setForcedWinner(roomCode, cardId) {
  if (!roomCode) return;
  try {
    if (cardId) await cacheClient.set(`forced:${roomCode}`, String(cardId));
    else await cacheClient.del(`forced:${roomCode}`);
  } catch (err) {}
}

module.exports = { initGameSocket, getActiveUserCount, setForcedWinner };