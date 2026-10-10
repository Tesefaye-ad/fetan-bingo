// ═══════════════════════════════════════════════════════
// GAME SOCKET — የ Fetan Bingo የጨዋታ ሞተር
// ═══════════════════════════════════════════════════════
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
// ቋሚ እሴቶች — ከ env የሚነበቡ
// ═══════════════════════════════════════════════════════
const CALL_INTERVAL_MS = Number(process.env.CALL_INTERVAL_MS || 1500);
const FIRST_CALL_DELAY_MS = Number(process.env.FIRST_CALL_DELAY_MS || 1500);
const WINNER_DISPLAY_MS = 6000;
const RECONCILE_MS = 500; // 👈 250 → 500 (CPU ቅነሳ)
const ARM_WINDOW_MS = 1500;
const PRIZE_SHARE = Number(process.env.PRIZE_SHARE || 0.8);
const MAX_ACTIVE_USERS = 20000; // 👈 ማህደረ ትውስታ መከላከያ

// ───────────────────────── Runtime state ─────────────────────────
const runtimes = new Map();
const startTimers = new Map();
const starting = new Map();
const lockTails = new Map();
const activeUserIds = new Set();

// ═══════════════════════════════════════════════════════
// 👈 USER → SOCKET INDEX (O(1) lookups — ለ 6000+ ተጠቃሚ ወሳኝ)
// ═══════════════════════════════════════════════════════
const userSockets = new Map(); // userId (String) -> Set<Socket>

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

// ───────────────────────── Helpers ─────────────────────────
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
  // 👈 O(1) average — reservoir ሳይሆን but skip ያደርጋል
  const remaining = max - calledSet.size;
  if (remaining <= 0) return null;
  let pick = Math.floor(Math.random() * remaining);
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
  return u?.username || u?.firstName || "Player";
}

function parseCardId(v) {
  const id = parseInt(v, 10);
  return Number.isInteger(id) && id >= 1 && id <= TOTAL_CARDS ? id : null;
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
function initGameSocket(io) {
  // ─────────────── Emit helpers ───────────────
  // 👈 O(1) — ሁሉንም sockets አይዞርም
  function emitToUser(userId, event, payload) {
    const set = userSockets.get(String(userId));
    if (!set || set.size === 0) return;
    for (const s of set) {
      if (s.connected) s.emit(event, payload);
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

  // ═══════════════════════════════════════════════════════
  // RUNTIME
  // ═══════════════════════════════════════════════════════
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
        // 👈 allCards Map lookup (O(N) → O(N+M))
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

        const prizePool =
          Math.floor(game.entryFee * PRIZE_SHARE) * players.length;
        const pattern = rooms.pickRandomPattern(game.entryFee);

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
      const num = randomUncalled(rt.calledSet, max);
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
        calledNumbers: rt.called,
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
      const users = await User.find({ _id: { $in: userIds } }).select(
        "username firstName telegramId"
      );
      const userById = new Map(users.map((u) => [String(u._id), u]));

      const winningCartelas = winners.map(({ player, pattern }) => ({
        telegramId: player.telegramId,
        name: displayName(userById.get(player.userId)),
        cardId: player.cardId,
        pattern,
        card: player.card,
        marked: player.marked,
      }));

      const prizePerCartela = Math.floor(
        rt.prizePool / winningCartelas.length
      );

      const panel = [];
      for (const userId of userIds) {
        const mine = winners.filter((w) => w.player.userId === userId);
        const prize = prizePerCartela * mine.length;
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
        if (!updated) continue;
        await Transaction.create({
          user: updated._id,
          type: "prize",
          amount: prize,
          balanceAfter: updated.balance,
          game: rt.gameId,
        });
        emitToUser(userId, "balance_update", { balance: updated.balance });
        panel.push({
          userId,
          telegramId: updated.telegramId,
          name: displayName(updated),
          cartelas: mine.map((w) => w.player.cardId),
          prize,
          newBalance: updated.balance,
        });
      }

      await Game.updateOne(
        { _id: rt.gameId },
        { $set: { winners: userIds, winningCartelas } }
      );

      const payload = {
        winPattern: rt.pattern,
        prizePool: rt.prizePool,
        prizePerCartela,
        totalCartelas: winningCartelas.length,
        winners: panel,
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
      if (wasWin && (rt.entryFee === 50 || rt.entryFee === 100)) {
        notifyWinnersGroup({
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
        }).catch((e) => console.error("[notify]", e.message));
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
        if (game.winningCartelas?.length || game.players.length === 0) {
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

  // ቋሚ ክፍሎች ሰርቨር ሲነሳ ይፈጠራሉ
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
  // 👈 MEMORY GUARD — በየ 5 ደቂቃ የሞቱ runtimes/timers ያጠፋል
  // ═══════════════════════════════════════════════════════
  setInterval(() => {
    const now = Date.now();

    // ሞተው የቀሩ runtimes
    for (const [roomCode, rt] of runtimes.entries()) {
      if (rt.done && now - (rt.result?.shownAt || now) > 30000) {
        clearTimeout(rt.timer);
        clearTimeout(rt.finishTimer);
        runtimes.delete(roomCode);
        console.log(`[memory] cleaned stale runtime: ${roomCode}`);
      }
    }

    // ሞተው የቀሩ startTimers (rare)
    for (const [roomCode, t] of startTimers.entries()) {
      if (t._idleStart && now - t._idleStart > 60000) {
        clearTimeout(t);
        startTimers.delete(roomCode);
      }
    }

    // ሞተው የቀሩ starting promises
    if (starting.size > 100) {
      console.warn(`[memory] starting map too large: ${starting.size}`);
    }

    // Log memory footprint
    const mem = process.memoryUsage();
    console.log(
      `[memory] rss=${Math.round(mem.rss / 1048576)}MB ` +
        `heap=${Math.round(mem.heapUsed / 1048576)}MB ` +
        `sockets=${io.engine.clientsCount} ` +
        `userSockets=${userSockets.size} ` +
        `runtimes=${runtimes.size}`
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
    // 👈 O(1) index መዝግብ
    addUserSocket(socket.userId, socket);

    // 👈 activeUserIds ገደብ
    if (activeUserIds.size < MAX_ACTIVE_USERS) {
      activeUserIds.add(socket.userId);
    }

    // ─────────── ካርቴላ መምረጫ ገጽ ሲከፈት ───────────
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

    // ─────────── ካርቴላ መምረጥ ───────────
    socket.on("select_card", async ({ roomCode, cardId } = {}) => {
      try {
        roomCode = rooms.normalizeRoomCode(roomCode);
        cardId = parseCardId(cardId);
        if (!roomCode || !cardId) return;

        const game = await rooms.ensureRoom(roomCode);
        const fail = (message) =>
          socket.emit("error_message", { message, cardId });

        if (game.status !== "waiting") return fail("⏱ ምርጫው ተዘግቷል");
        const deadline = deadlineOf(game);
        if (deadline <= Date.now()) return fail("⏱ ሰዓቱ አልቋል");

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

        io.to(roomCode).emit("card_selected", { cardId });
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        console.error("[select_card]", err);
      }
    });

    // ─────────── ካርቴላ መመለስ ───────────
    socket.on("deselect_card", async ({ roomCode, cardId } = {}) => {
      try {
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

        io.to(roomCode).emit("card_deselected", { cardId });
      } catch (err) {
        console.error("[deselect_card]", err);
      }
    });

    // ─────────── ወደ ላይቭ ጌም መግባት ───────────
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

    // 👈 O(1) disconnect
    socket.on("disconnect", () => {
      removeUserSocket(socket.userId, socket);
      // ሌላ socket ካለው Map ውስጥ ይኖራል፣ ከሌለ activeUserIds ይወገዳል
      if (!userSockets.has(socket.userId)) {
        activeUserIds.delete(socket.userId);
      }
    });
  });
}

module.exports = { initGameSocket, getActiveUserCount };