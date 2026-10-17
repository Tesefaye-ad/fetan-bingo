// ═══════════════════════════════════════════════════════
// GAME SOCKET — Fetan Bingo game engine
// ═══════════════════════════════════════════════════════
const crypto = require("crypto");
const mongoose = require("mongoose");
const Game = require("../models/Game");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const {
  TOTAL_CARDS,
  checkWin,
  computeMarked,
} = require("../utils/bingoCard");
const { verifySocketToken } = require("../routes/auth");
const rooms = require("../services/rooms");
const { notifyWinnersGroup } = require("../services/winnerNotify");

// ═══════════════════════════════════════════════════════
// CONSTANTS — 👈 OPTIMIZED for 4500 concurrent users
// ═══════════════════════════════════════════════════════
const CALL_INTERVAL_MS = Number(process.env.CALL_INTERVAL_MS || 1500);
const FIRST_CALL_DELAY_MS = Number(process.env.FIRST_CALL_DELAY_MS || 1500);
const WINNER_DISPLAY_MS = 6000;
const RECONCILE_MS = 2000;
const ARM_WINDOW_MS = 1500;
const PRIZE_SHARE = Number(process.env.PRIZE_SHARE || 0.8);
const MAX_ACTIVE_USERS = 20000;
const MIN_PLAYERS = Math.max(1, Number(process.env.MIN_PLAYERS || 2));
const CARD_BATCH_MS = 250;

const runtimes = new Map();
const startTimers = new Map();
const starting = new Map();
const lockTails = new Map();
const activeUserIds = new Set();

// ✅ አዲስ የተጨመረ፦ አድሚን የሚገድበውን ካርቴላ ለማስቀመጥ
const forcedWinners = new Map(); // Map<roomCode, cardId>

// ═══════════════════════════════════════════════════════
// Card-selection batching per room
// 90 selections/sec → 4 emits/sec (250x reduction)
// ═══════════════════════════════════════════════════════
const cardBatches = new Map();

// User -> Set<Socket>
const userSockets = new Map();

function addUserSocket(userId, socket) {
  let set = userSockets.get(userId);
  if (!set) {
    set = new Set();
    userSockets.set(userId, set);
  }
  set.add(socket);
}

function removeUserSocket(userId, socket) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) userSockets.delete(userId);
}

function getActiveUserCount() {
  return activeUserIds.size;
}

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

// ✅ FIX: firstName እና lastName ካለው ሁለቱንም ያሳያል፣ ከሌለው firstName
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

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
function initGameSocket(io) {
  function emitToUser(userId, event, payload) {
    const set = userSockets.get(String(userId));
    if (!set || set.size === 0) return;
    for (const s of set) {
      if (s.connected) s.emit(event, payload);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Batched card broadcast helper
  // ═══════════════════════════════════════════════════════
  function queueCardBroadcast(roomCode, cardId) {
    let b = cardBatches.get(roomCode);
    if (!b) {
      b = { cardIds: new Set(), timer: null };
      cardBatches.set(roomCode, b);
    }
    b.cardIds.add(cardId);

    if (!b.timer) {
      b.timer = setTimeout(() => {
        const ids = [...b.cardIds];
        b.cardIds.clear();
        b.timer = null;
        if (ids.length > 0) {
          io.to(roomCode).emit("cards_taken", { cardIds: ids });
        }
        if (cardBatches.get(roomCode)?.cardIds.size === 0) {
          cardBatches.delete(roomCode);
        }
      }, CARD_BATCH_MS);
    }
  }

  async function broadcastRoomState(roomCode) {
    const g = await Game.findOne({ roomCode }).select(rooms.LIGHT_SELECT);
    if (g) io.to(roomCode).emit("room_state", rooms.publicState(g));
    return g;
  }

  async function refund(userId, amount, gameId, meta) {
    const u = await User.findByIdAndUpdate(
      userId,
      { $inc: { balance: amount } },
      { new: true }
    );
    if (!u) return null;
    await Transaction.create({
      user: u._id,
      type: "refund",
      amount,
      balanceAfter: u.balance,
      game: gameId,
      meta,
    });
    emitToUser(u._id, "balance_update", { balance: u.balance });
    return u;
  }

  function createRuntime({
    gameId,
    roomCode,
    entryFee,
    prizePool,
    pattern,
    players,
    called,
  }) {
    const rt = {
      gameId,
      roomCode,
      entryFee,
      prizePool,
      pattern,
      players,
      called: [...called],
      calledSet: new Set(called),
      index: new Map(),
      timer: null,
      finishTimer: null,
      nextAt: 0,
      done: false,
      result: null,
      persist: Promise.resolve(),
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
      if (!grouped.has(p.userId))
        grouped.set(p.userId, { cards: [], markedCards: [], cardIds: [] });
      const g = grouped.get(p.userId);
      g.cards.push(p.card);
      g.markedCards.push(p.marked);
      g.cardIds.push(p.cardId);
    }
    for (const [userId, payload] of grouped)
      emitToUser(userId, "your_cards", payload);
  }

  // ═══════════════════════════════════════════════════════
  // START GAME
  // ═══════════════════════════════════════════════════════
  function startGame(roomCode) {
    if (runtimes.has(roomCode)) return Promise.resolve();
    if (starting.has(roomCode)) return starting.get(roomCode);
    const p = doStartGame(roomCode).finally(() => starting.delete(roomCode));
    starting.set(roomCode, p);
    return p;
  }

  async function doStartGame(roomCode) {
    try {
      await withRoomLock(roomCode, async () => {
        const light = await Game.findOne({ roomCode }).select(
          rooms.LIGHT_SELECT
        );
        if (!light || light.status !== "waiting") return;
        if (deadlineOf(light) > Date.now() + 20) return;

        const game = await Game.findOneAndUpdate(
          {
            roomCode,
            status: "waiting",
            "reservedCards.0": { $exists: true },
          },
          {
            $set: {
              status: "active",
              startedAt: new Date(),
              calledNumbers: [],
              winners: [],
              winningCartelas: [],
              selectionEndsAt: null,
            },
          },
          { new: true }
        );

        if (!game) {
          const fresh = await rooms.resetToWaiting(roomCode);
          if (fresh)
            io.to(roomCode).emit("room_state", rooms.publicState(fresh));
          return;
        }

        const seen = new Set();
        const players = [];
        const cardMap = new Map(
          (game.allCards || []).map((c) => [c.cardId, c])
        );
        for (const r of game.reservedCards) {
          if (seen.has(r.cardId)) continue;
          seen.add(r.cardId);
          const cd = cardMap.get(r.cardId);
          if (!cd) {
            await refund(r.user, game.entryFee, game._id, {
              reason: "card-missing",
              cardId: r.cardId,
            });
            continue;
          }
          players.push({
            user: r.user,
            telegramId: r.telegramId,
            cardId: cd.cardId,
            card: cd.card,
            marked: computeMarked(cd.card, []),
            hasWon: false,
          });
        }

        if (players.length < MIN_PLAYERS) {
          console.warn(
            `[startGame:${roomCode}] ${players.length} < MIN_PLAYERS=${MIN_PLAYERS}`
          );
          for (const p of players) {
            await refund(p.user, game.entryFee, game._id, {
              reason: "min-players-not-met",
              minPlayers: MIN_PLAYERS,
            });
          }
          const fresh = await rooms.resetToWaiting(roomCode);
          if (fresh)
            io.to(roomCode).emit("room_state", rooms.publicState(fresh));
          return;
        }

        const prizePool =
          Math.floor(game.entryFee * PRIZE_SHARE) * players.length;

        const pattern =
          game.winPattern || rooms.pickRandomPattern(game.entryFee);

        await Game.updateOne(
          { _id: game._id },
          {
            $set: { players, reservedCards: [], prizePool, winPattern: pattern },
          }
        );

        const rt = createRuntime({
          gameId: game._id,
          roomCode,
          entryFee: game.entryFee,
          prizePool,
          pattern,
          players: players.map((p) => ({
            userId: String(p.user),
            telegramId: p.telegramId,
            cardId: p.cardId,
            card: p.card,
            marked: p.marked,
            hasWon: false,
          })),
          called: [],
        });
        runtimes.set(roomCode, rt);

        io.to(roomCode).emit("game_started", {
          roomCode,
          winPattern: pattern,
          playerCount: players.length,
          prizePool,
          entryFee: game.entryFee,
          serverTime: Date.now(),
        });
        sendCardsToOwners(rt);
        broadcastRoomState(roomCode).catch(() => {});

        scheduleTick(rt, FIRST_CALL_DELAY_MS);
      });
    } catch (err) {
      console.error(`[startGame:${roomCode}]`, err);
    }
  }

  // ═══════════════════════════════════════════════════════
  // NUMBER CALLER
  // ═══════════════════════════════════════════════════════
  function scheduleTick(rt, firstDelayMs) {
    rt.nextAt = Date.now() + firstDelayMs;
    rt.timer = setTimeout(() => tick(rt), firstDelayMs);
  }

  async function tick(rt) {
    if (rt.done) return;
    try {
      const max = 75;
      let num = null;

      // ✅ የተገደደ አሸናፊ ካለ (Admin forced win)
      const forcedCardId = forcedWinners.get(rt.roomCode);
      if (forcedCardId) {
        const targetPlayer = rt.players.find(p => p.cardId === forcedCardId);
        if (targetPlayer) {
          const uncalledOnCard = targetPlayer.card.flat().filter(n => n !== 0 && !rt.calledSet.has(n));
          if (uncalledOnCard.length > 0) {
            num = uncalledOnCard[crypto.randomInt(uncalledOnCard.length)];
            console.log(`[force-win:${rt.roomCode}] ለካርቴላ #${forcedCardId} ቁጥር ${num} ተመርጧል`);
          }
        }
      }

      // የተገደደ ቁጥር ካልተገኘ በተለመደው መንገድ ይምረጥ
      if (num === null) {
        num = randomUncalled(rt.calledSet, max);
      }

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

      io.to(rt.roomCode).emit("number_called", {
        number: num,
        letter: letterFor(num),
        winPattern: rt.pattern,
        serverTime: Date.now(),
      });

      rt.persist = rt.persist
        .then(() =>
          Game.updateOne({ _id: rt.gameId }, { $push: { calledNumbers: num } })
        )
        .catch((e) => console.error(`[persist:${rt.roomCode}]`, e.message));

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
    }

    if (!rt.done) {
      rt.nextAt += CALL_INTERVAL_MS;
      rt.timer = setTimeout(
        () => tick(rt),
        Math.max(0, rt.nextAt - Date.now())
      );
    }
  }

  // ═══════════════════════════════════════════════════════
  // WINNERS
  // ═══════════════════════════════════════════════════════
  async function processWinners(rt, winners) {
    clearTimeout(rt.timer);
    try {
      const userIds = [...new Set(winners.map((w) => w.player.userId))];
      
      // ✅ FIX: lastName እንዲመጣ ተጨምሯል
      const users = await User.find({ _id: { $in: userIds } }).select(
        "username firstName lastName telegramId"
      );
      const userById = new Map(users.map((u) => [String(u._id), u]));

      const winningCartelas = winners.map(({ player, pattern }) => ({
        telegramId: player.telegramId,
        name: displayName(userById.get(player.userId)), // firstName + lastName
        cardId: player.cardId,
        pattern,
        card: player.card,
        marked: player.marked,
      }));

      const prizePerUser = Math.floor(rt.prizePool / userIds.length);

      const panel = [];
      for (const userId of userIds) {
        const mine = winners.filter((w) => w.player.userId === userId);
        const prize = prizePerUser;
        
        let prizeTx;
        try {
          prizeTx = await Transaction.create({
            user: userId,
            type: "prize",
            amount: prize,
            balanceAfter: 0,
            game: rt.gameId,
            status: "completed",
            meta: { cartelas: mine.map((w) => w.player.cardId) },
          });
        } catch (e) {
          if (e.code === 11000) continue;
          throw e;
        }
        
        const updated = await User.findByIdAndUpdate(
          userId,
          {
            $inc: {
              balance: prize,
              gamesWon: mine.length,
              totalWinnings: prize,
            },
          },
          { new: true }
        );
        if (!updated) {
          await Transaction.updateOne(
            { _id: prizeTx._id },
            { $set: { status: "failed" } }
          );
          continue;
        }
        await Transaction.updateOne(
          { _id: prizeTx._id },
          { $set: { balanceAfter: updated.balance } }
        );
        emitToUser(userId, "balance_update", { balance: updated.balance });
        panel.push({
          userId,
          telegramId: updated.telegramId,
          name: displayName(updated), // firstName + lastName
          cartelas: mine.map((w) => w.player.cardId),
          prize,
          newBalance: updated.balance,
        });
      }

      await Game.updateOne(
        { _id: rt.gameId },
        { $set: { winners: userIds, winningCartelas } }
      );

      const sortedPanel = [...panel].sort((a, b) => b.prize - a.prize);

      const payload = {
        winPattern: rt.pattern,
        prizePool: rt.prizePool,
        prizePerUser,
        totalCartelas: winningCartelas.length,
        winnerCount: sortedPanel.length,
        winners: sortedPanel,
        winningCartelas: winningCartelas.map((w) => ({
          telegramId: w.telegramId,
          name: w.name,
          cardId: w.cardId,
          subPattern: w.pattern,
          card: w.card,
          marked: w.marked,
        })),
        displayMs: WINNER_DISPLAY_MS,
        serverTime: Date.now(),
      };

      rt.result = { payload, shownAt: Date.now() };

      console.log(
        `[winners:${rt.roomCode}] ✅ ${sortedPanel.length} user(s) — ` +
          `prizePool=${rt.prizePool}ETB, perUser=${prizePerUser}ETB`
      );

      io.to(rt.roomCode).emit("bingo_claimed", payload);
    } catch (err) {
      console.error(`[processWinners:${rt.roomCode}]`, err);
    }

    rt.finishTimer = setTimeout(
      () =>
        finishRound(
          rt,
          rt.result?.payload.winners || [],
          rt.result?.payload.winningCartelas || [],
          true
        ),
      WINNER_DISPLAY_MS
    );
  }

  async function finishRound(rt, panel, winningCartelas, wasWin = false) {
    const { roomCode } = rt;
    try {
      // ✅ ጨዋታው ሲያልቅ የተገደደውን አሸናፊ አጥፋ
      forcedWinners.delete(roomCode);

      const isWeekly = rt.entryFee === 50 || rt.entryFee === 100;
      let notificationOk = true;

      if (wasWin && isWeekly && panel.length > 0 && winningCartelas.length > 0) {
        try {
          const r = await notifyWinnersGroup({
            roomCode,
            entryFee: rt.entryFee,
            prizePool: rt.prizePool,
            winPattern: rt.pattern,
            winners: panel,
            winningCartelas: winningCartelas.map((w) => ({
              cardId: w.cardId,
              card: w.card,
              marked: w.marked,
              pattern: w.subPattern || w.pattern,
            })),
          });
          notificationOk = r?.ok !== false;
        } catch (e) {
          console.error("[notify]", e.message);
          notificationOk = false;
        }
      }

      if (notificationOk) {
        await Game.updateOne(
          { _id: rt.gameId },
          { $set: { notifiedAt: new Date() } }
        ).catch((e) => console.error("[notify:mark]", e.message));
      }

      const playerIds = [...new Set(rt.players.map((p) => p.userId))];
      await User.updateMany(
        { _id: { $in: playerIds } },
        { $inc: { gamesPlayed: 1 } }
      );

      const fresh = await rooms.resetToWaiting(roomCode);

      io.to(roomCode).emit("game_over", {
        winners: winningCartelas,
        totalWinners: winningCartelas.length,
        winnerCount: panel.length,
        prizePool: rt.prizePool,
        winPattern: rt.pattern,
        nextGame: fresh ? rooms.publicState(fresh) : null,
      });
      io.to(roomCode).emit("next_game_ready", { roomCode });
      if (fresh) io.to(roomCode).emit("room_state", rooms.publicState(fresh));
    } catch (err) {
      console.error(`[finishRound:${roomCode}]`, err);
    } finally {
      clearTimeout(rt.timer);
      clearTimeout(rt.finishTimer);
      runtimes.delete(roomCode);
    }
  }

  // ═══════════════════════════════════════════════════════
  // RESUME
  // ═══════════════════════════════════════════════════════
  async function retryWinnerNotification(game) {
    const prizeTxs = await Transaction.find({
      game: game._id,
      type: "prize",
    }).lean();
    if (prizeTxs.length === 0) return;

    const userIds = [...new Set(prizeTxs.map((t) => String(t.user)))];
    // ✅ FIX: lastName እንዲመጣ ተጨምሯል
    const users = await User.find({ _id: { $in: userIds } })
      .select("username firstName lastName telegramId")
      .lean();
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const panel = prizeTxs.map((tx) => {
      const u = userById.get(String(tx.user));
      return {
        userId: String(tx.user),
        telegramId: u?.telegramId,
        name: displayName(u),
        cartelas: tx.meta?.cartelas || [],
        prize: tx.amount,
        newBalance: tx.balanceAfter,
      };
    });

    const r = await notifyWinnersGroup({
      roomCode: game.roomCode,
      entryFee: game.entryFee,
      prizePool: game.prizePool,
      winPattern: game.winPattern,
      winners: panel,
      winningCartelas: (game.winningCartelas || []).map((w) => ({
        cardId: w.cardId,
        card: w.card,
        marked: w.marked,
        pattern: w.pattern,
      })),
    });

    if (r?.ok !== false) {
      await Game.updateOne(
        { _id: game._id },
        { $set: { notifiedAt: new Date() } }
      );
      console.log(`[resume:${game.roomCode}] ✅ winner notification resent`);
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
    try {
      await withRoomLock(roomCode, async () => {
        const game = await Game.findOne({ roomCode, status: "active" });
        if (!game) return;

        const alreadyPaid = await Transaction.exists({
          game: game._id,
          type: "prize",
        });

        const isWeekly = game.entryFee === 50 || game.entryFee === 100;
        if (
          alreadyPaid &&
          game.winningCartelas?.length > 0 &&
          !game.notifiedAt &&
          isWeekly
        ) {
          try {
            await retryWinnerNotification(game);
          } catch (e) {
            console.error(
              `[resume:${roomCode}] notify retry failed:`,
              e.message
            );
          }
        }

        if (
          alreadyPaid ||
          game.winningCartelas?.length ||
          game.players.length === 0
        ) {
          const fresh = await rooms.resetToWaiting(roomCode);
          if (fresh)
            io.to(roomCode).emit("room_state", rooms.publicState(fresh));
          return;
        }

        const players = game.players.map((p) => ({
          userId: String(p.user),
          telegramId: p.telegramId,
          cardId: p.cardId,
          card: p.card,
          marked: computeMarked(p.card, game.calledNumbers),
          hasWon: false,
        }));
        const rt = createRuntime({
          gameId: game._id,
          roomCode,
          entryFee: game.entryFee,
          prizePool: game.prizePool,
          pattern: game.winPattern,
          players,
          called: game.calledNumbers,
        });
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
    }
  }

  // ═══════════════════════════════════════════════════════
  // RECONCILER
  // ═══════════════════════════════════════════════════════
  let reconciling = false;
  async function reconcile() {
    if (reconciling || mongoose.connection.readyState !== 1) return;
    reconciling = true;
    try {
      const waiting = await Game.find({ status: "waiting" })
        .select("roomCode isWeeklyGame selectionEndsAt scheduledStart")
        .lean();
      const now = Date.now();
      for (const g of waiting) {
        const t = deadlineOf(g);
        if (!t) {
          await rooms.resetToWaiting(g.roomCode);
          continue;
        }
        const delta = t - now;
        if (delta <= 0) {
          startGame(g.roomCode);
        } else if (delta <= ARM_WINDOW_MS && !startTimers.has(g.roomCode)) {
          startTimers.set(
            g.roomCode,
            setTimeout(() => {
              startTimers.delete(g.roomCode);
              startGame(g.roomCode);
            }, delta)
          );
        }
      }

      const active = await Game.find({ status: "active" })
        .select("roomCode")
        .lean();
      for (const g of active) {
        if (!runtimes.has(g.roomCode) && !starting.has(g.roomCode)) {
          resumeGame(g.roomCode);
        }
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
      console.error("[boot] failed, retrying in 3s:", err.message);
      setTimeout(boot, 3000);
    }
  })();

  // ═══════════════════════════════════════════════════════
  // MEMORY GUARD
  // ═══════════════════════════════════════════════════════
  setInterval(() => {
    const now = Date.now();

    for (const [roomCode, rt] of runtimes.entries()) {
      if (rt.done && now - (rt.result?.shownAt || now) > 30000) {
        clearTimeout(rt.timer);
        clearTimeout(rt.finishTimer);
        runtimes.delete(roomCode);
        console.log(`[memory] cleaned stale runtime: ${roomCode}`);
      }
    }

    for (const [roomCode, t] of startTimers.entries()) {
      if (t._idleStart && now - t._idleStart > 60000) {
        clearTimeout(t);
        startTimers.delete(roomCode);
      }
    }

    if (starting.size > 100) {
      console.warn(`[memory] starting map too large: ${starting.size}`);
    }

    const mem = process.memoryUsage();
    console.log(
      `[memory] rss=${Math.round(mem.rss / 1048576)}MB ` +
        `heap=${Math.round(mem.heapUsed / 1048576)}MB ` +
        `sockets=${io.engine.clientsCount} ` +
        `userSockets=${userSockets.size} ` +
        `runtimes=${runtimes.size} ` +
        `batches=${cardBatches.size}`
    );
  }, 5 * 60 * 1000);

  // ═══════════════════════════════════════════════════════
  // SOCKET AUTH + EVENTS
  // ═══════════════════════════════════════════════════════
  io.use((socket, next) => {
    const payload = verifySocketToken(socket.handshake.auth?.token);
    if (!payload) return next(new Error("unauthorized"));
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

    if (activeUserIds.size < MAX_ACTIVE_USERS) {
      activeUserIds.add(socket.userId);
    }

    socket.on("watch_room", async ({ roomCode } = {}) => {
      try {
        roomCode = rooms.normalizeRoomCode(roomCode);
        if (!roomCode) return;
        const game = await rooms.ensureRoom(roomCode);
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.emit("room_state", rooms.publicState(game));
        socket.emit("my_reservations", {
          roomCode,
          cardIds: game.reservedCards
            .filter((r) => r.telegramId === socket.telegramId)
            .map((r) => r.cardId),
        });
      } catch (err) {
        console.error("[watch_room]", err);
      }
    });

    socket.on("select_card", async ({ roomCode, cardId } = {}) => {
      try {
        if (!socket.allow()) return;
        roomCode = rooms.normalizeRoomCode(roomCode);
        cardId = parseCardId(cardId);
        if (!roomCode || !cardId) return;

        const game = await rooms.ensureRoom(roomCode);
        const fail = (message) =>
          socket.emit("error_message", { message, cardId });

        if (game.status !== "waiting") return fail("⏱ ምርጫው ተዘግቷል");
        const deadline = deadlineOf(game);
        if (deadline <= Date.now()) return fail("⏱ ሰዓቱ አልቋል");

        const totalCards =
          (game.reservedCards?.length || 0) + (game.players?.length || 0);
        if (totalCards >= rooms.MAX_CARDS_PER_ROOM) {
          return fail(`❌ ክፍሉ ሙሉ ነው (${rooms.MAX_CARDS_PER_ROOM} ካርዶች)`);
        }

        const mine = game.reservedCards.filter(
          (r) => r.telegramId === socket.telegramId
        );
        if (mine.some((r) => r.cardId === cardId)) return;

        const user = await User.findOneAndUpdate(
          {
            _id: socket.userId,
            isBanned: { $ne: true },
            balance: { $gte: game.entryFee },
          },
          { $inc: { balance: -game.entryFee } },
          { new: true }
        );
        if (!user) return fail("❌ ቀሪ ሂሳብ በቂ አይደለም");

        const deadlineField = game.isWeeklyGame
          ? "scheduledStart"
          : "selectionEndsAt";
        const res = await Game.updateOne(
          {
            roomCode,
            status: "waiting",
            [deadlineField]: { $gt: new Date() },
            "reservedCards.cardId": { $ne: cardId },
            "players.cardId": { $ne: cardId },
          },
          {
            $push: {
              reservedCards: {
                user: user._id,
                telegramId: socket.telegramId,
                cardId,
              },
            },
          }
        );

        if (res.modifiedCount !== 1) {
          await refund(user._id, game.entryFee, game._id, {
            reason: "reserve-failed",
            cardId,
          });
          return fail(`❌ Card #${cardId} ተወስዷል ወይም ሰዓቱ አልቋል`);
        }

        await Transaction.create({
          user: user._id,
          type: "entry_fee",
          amount: game.entryFee,
          balanceAfter: user.balance,
          game: game._id,
          meta: { action: "reserve", cardId },
        });

        queueCardBroadcast(roomCode, cardId);
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        console.error("[select_card]", err);
      }
    });

    socket.on("deselect_card", async ({ roomCode, cardId } = {}) => {
      try {
        if (!socket.allow()) return;
        roomCode = rooms.normalizeRoomCode(roomCode);
        cardId = parseCardId(cardId);
        if (!roomCode || !cardId) return;

        const game = await rooms.ensureRoom(roomCode);
        if (game.status !== "waiting" || deadlineOf(game) <= Date.now()) return;

        const res = await Game.updateOne(
          {
            roomCode,
            status: "waiting",
            reservedCards: {
              $elemMatch: { cardId, telegramId: socket.telegramId },
            },
          },
          {
            $pull: {
              reservedCards: { cardId, telegramId: socket.telegramId },
            },
          }
        );
        if (res.modifiedCount !== 1) return;

        await refund(socket.userId, game.entryFee, game._id, {
          action: "deselect",
          cardId,
        });

        io.to(roomCode).emit("card_released", { cardId });
      } catch (err) {
        console.error("[deselect_card]", err);
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
            roomCode,
            status: game.status,
            winPattern: rt?.pattern || game.winPattern || "any-row",
            prizePool: rt?.prizePool ?? game.prizePool ?? 0,
            playerCount: rt ? rt.players.length : game.players.length,
            entryFee: game.entryFee,
            calledNumbers: rt ? rt.called : game.calledNumbers || [],
            serverTime: Date.now(),
          };

          const myCards = rt
            ? rt.players.filter((p) => p.userId === socket.userId)
            : [];

          if (myCards.length > 0) {
            socket.emit("state_restore", {
              ...base,
              cards: myCards.map((p) => ({
                cardId: p.cardId,
                card: p.card,
                marked: p.marked,
              })),
            });
          } else {
            socket.emit("spectator_mode", {
              ...base,
              pendingCardIds: game.reservedCards
                .filter((r) => r.telegramId === socket.telegramId)
                .map((r) => r.cardId),
            });
          }

          if (rt?.result) {
            const left = WINNER_DISPLAY_MS - (Date.now() - rt.result.shownAt);
            if (left > 200) {
              socket.emit("bingo_claimed", {
                ...rt.result.payload,
                displayMs: left,
              });
            }
          }
          socket.emit("room_state", rooms.publicState(game));
        }
      } catch (err) {
        console.error("[join_room]", err);
      }
    });

    socket.on("leave_room", () => {
      if (socket.data.roomCode) socket.leave(socket.data.roomCode);
      socket.data.roomCode = null;
    });

    socket.on("disconnect", () => {
      removeUserSocket(socket.userId, socket);
      if (!userSockets.has(socket.userId)) {
        activeUserIds.delete(socket.userId);
      }
    });
  });
}

// ✅ አድሚን የሚጠቀመው ፈንክሽን
function setForcedWinner(roomCode, cardId) {
  if (!roomCode) return;
  if (cardId) {
    forcedWinners.set(roomCode, Number(cardId));
  } else {
    forcedWinners.delete(roomCode);
  }
}

module.exports = { initGameSocket, getActiveUserCount, setForcedWinner };