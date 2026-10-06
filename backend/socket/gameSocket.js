// ═══════════════════════════════════════════════════════
// GAME SOCKET — የ Fetan Bingo የጨዋታ ሞተር
// ═══════════════════════════════════════════════════════
// ዑደት (ለእያንዳንዱ ክፍል):
//   waiting (ካርቴላ መምረጥ, ቋሚ ሰዓት)  →  active (ቁጥር መጥራት, በየ 1 ሰከንድ)
//   →  winner popup (5 ሰከንድ)  →  game_over + reset → waiting (አዲስ ሰዓት)
//
// • ROOM10 / ROOM20 : ሁልጊዜ የሚሽከረከር 50 ሰከንድ (SELECTION_TIMER_MS) — ለሁሉም አንድ ዓይነት
// • ROOM50 / ROOM100: በየቀኑ 12:00:00 / 12:05:00 (ኢትዮጵያ ሰዓት) — utils/schedule.js
const mongoose = require("mongoose");
const Game = require("../models/Game");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const {
  TOTAL_CARDS,
  checkWin,
  computeMarked,
  getPatternForRoom,
} = require("../utils/bingoCard");
const { verifySocketToken } = require("../routes/auth");
const rooms = require("../services/rooms");
const { notifyWinnersGroup } = require("../services/winnerNotify");

// ───────────────────────── ቋሚ እሴቶች ─────────────────────────
const CALL_INTERVAL_MS = 1000; // የቁጥር አጠራር ልዩነት — በትክክል 1 ሰከንድ
const FIRST_CALL_DELAY_MS = 300; // ጨዋታ ከጀመረ በኋላ የመጀመሪያው ጥሪ
const WINNER_DISPLAY_MS = 5000; // የአሸናፊ ፖፕ-አፕ ቆይታ
const MAX_CARDS_PER_USER = 3;
const RECONCILE_MS = 250;
const ARM_WINDOW_MS = 1500; // ከመጀመሪያው በፊት በዚህ ጊዜ ውስጥ ትክክለኛ ታይመር ይቀናበራል
const PRIZE_SHARE = 0.8; // 80% ወደ ሽልማት ገንዳ

// ───────────────────────── Runtime state ─────────────────────────
const runtimes = new Map(); // roomCode → በሂደት ላይ ያለ ጨዋታ (በ memory)
const startTimers = new Map(); // roomCode → ትክክለኛ የመጀመሪያ ታይመር
const starting = new Map(); // roomCode → startGame/resume promise (በሂደት ላይ ያሉ)
const lockTails = new Map();
const activeUserIds = new Set();

function getActiveUserCount() {
  return activeUserIds.size;
}

// ───────────────────────── Helpers ─────────────────────────
/** በአንድ ክፍል ላይ ስራዎችን በተራ ያስኬዳል (polling የሌለው mutex) */
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
  const pool = [];
  for (let i = 1; i <= max; i++) if (!calledSet.has(i)) pool.push(i);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
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
  function emitToUser(userId, event, payload) {
    for (const s of io.sockets.sockets.values()) {
      if (s.userId === String(userId)) s.emit(event, payload);
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
  // RUNTIME (በ memory ያለ የጨዋታ ሁኔታ)
  // ═══════════════════════════════════════════════════════
  function createRuntime({ gameId, roomCode, entryFee, prizePool, pattern, players, called }) {
    const rt = {
      gameId,
      roomCode,
      entryFee,
      prizePool,
      pattern,
      players,
      called: [...called],
      calledSet: new Set(called),
      index: new Map(), // ቁጥር → [{player, r, c}]
      timer: null,
      finishTimer: null,
      nextAt: 0,
      done: false,
      result: null, // { payload, shownAt }
      persist: Promise.resolve(),
    };
    for (const p of players) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const v = p.card[r][c];
          if (v === 0) continue; // FREE
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
    for (const [userId, payload] of grouped) emitToUser(userId, "your_cards", payload);
  }

  // ═══════════════════════════════════════════════════════
  // START GAME — ሰዓቱ ሲያልቅ ወዲያውኑ
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
        const light = await Game.findOne({ roomCode }).select(rooms.LIGHT_SELECT);
        if (!light || light.status !== "waiting") return;
        if (deadlineOf(light) > Date.now() + 20) return; // ገና አልደረሰም

        // 1) በአንድ atomic ስራ ወደ active — ከዚህ በኋላ ማንም ካርቴላ ማስያዝ አይችልም
        const game = await Game.findOneAndUpdate(
          { roomCode, status: "waiting", "reservedCards.0": { $exists: true } },
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

        // 2) ማንም ካርቴላ ካልያዘ → ዑደቱን እንደገና ጀምር (መደበኛ: አዲስ 50s, ሳምንታዊ: ነገ)
        if (!game) {
          const fresh = await rooms.resetToWaiting(roomCode);
          if (fresh) io.to(roomCode).emit("room_state", rooms.publicState(fresh));
          console.log(`[startGame] ${roomCode} — no cards selected → new cycle`);
          return;
        }

        // 3) የተያዙ ካርቴላዎች → ተጫዋቾች
        const seen = new Set();
        const players = [];
        for (const r of game.reservedCards) {
          if (seen.has(r.cardId)) continue;
          seen.add(r.cardId);
          const cd = game.allCards.find((c) => c.cardId === r.cardId);
          if (!cd) {
            await refund(r.user, game.entryFee, game._id, { reason: "card-missing", cardId: r.cardId });
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

        const prizePool = Math.floor(game.entryFee * PRIZE_SHARE) * players.length;
        const pattern = getPatternForRoom(game.entryFee);
        await Game.updateOne(
          { _id: game._id },
          { $set: { players, reservedCards: [], prizePool, winPattern: pattern } }
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

        // 4) ፓተርን + ካርዶች ወዲያውኑ ለሁሉም
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

        console.log(
          `[startGame] ${roomCode} — ${players.length} card(s), pool=${prizePool}, pattern=${pattern}`
        );
        scheduleTick(rt, FIRST_CALL_DELAY_MS);
      });
    } catch (err) {
      console.error(`[startGame:${roomCode}]`, err);
    }
  }

  // ═══════════════════════════════════════════════════════
  // NUMBER CALLER — በየ 1 ሰከንድ (drift የሌለው)
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

      // Auto-mark (በ memory) + ተጎድተው የሚሸነፉ ተጫዋቾችን መለየት
      const candidates = new Set();
      for (const hit of rt.index.get(num) || []) {
        hit.player.marked[hit.r][hit.c] = true;
        candidates.add(hit.player);
      }

      // ወዲያውኑ ለሁሉም (DB ን አንጠብቅም — ሰዓቱ እንዳይዘገይ)
      io.to(rt.roomCode).emit("number_called", {
        number: num,
        letter: letterFor(num),
        calledNumbers: rt.called,
        winPattern: rt.pattern,
        serverTime: Date.now(),
      });

      // በትእዛዝ ቅደም ተከተል DB ላይ ማስቀመጥ
      rt.persist = rt.persist
        .then(() =>
          Game.updateOne({ _id: rt.gameId }, { $push: { calledNumbers: num } })
        )
        .catch((e) => console.error(`[persist:${rt.roomCode}]`, e.message));

      // ድል ማረጋገጥ
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

    // ቀጣዩ ጥሪ — ከመጀመሪያው ጊዜ ጋር በማስላት በትክክል 1 ሰከንድ
    if (!rt.done) {
      rt.nextAt += CALL_INTERVAL_MS;
      rt.timer = setTimeout(() => tick(rt), Math.max(0, rt.nextAt - Date.now()));
    }
  }

  // ═══════════════════════════════════════════════════════
  // WINNERS — ሽልማት, ፖፕ-አፕ (5s), ከዚያ reset
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

      const prizePerCartela = Math.floor(rt.prizePool / winningCartelas.length);

      // ለያንዳንዱ ተጫዋች (ብዙ ካርቴላ ቢኖረው ተደምሮ)
      const panel = [];
      for (const userId of userIds) {
        const mine = winners.filter((w) => w.player.userId === userId);
        const prize = prizePerCartela * mine.length;
        const updated = await User.findByIdAndUpdate(
          userId,
          { $inc: { balance: prize, gamesWon: mine.length, totalWinnings: prize } },
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
      console.log(`[bingo] ${rt.roomCode} — ${panel.length} winner(s), ${winningCartelas.length} cartela(s)`);
    } catch (err) {
      console.error(`[processWinners:${rt.roomCode}]`, err);
    }

    // 5 ሰከንድ በኋላ (ስህተት ቢኖርም) → screenshot + reset
    rt.finishTimer = setTimeout(
      () => finishRound(rt, rt.result?.payload.winners || [], rt.result?.payload.winningCartelas || [], true),
      WINNER_DISPLAY_MS
    );
  }

  async function finishRound(rt, panel, winningCartelas, wasWin = false) {
    const { roomCode } = rt;
    try {
      // Play 50 / Play 100: ፖፕ-አፕ 5 ሰከንድ ከታየ በኋላ ስክሪንሾት ወደ ቴሌግራም ግሩፕ
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
      await User.updateMany({ _id: { $in: playerIds } }, { $inc: { gamesPlayed: 1 } });

      // መጀመሪያ DB ን ዳግም አስጀምር — client ወደ ምርጫ ሲመለስ አዲስ ሰዓት እንዲያገኝ
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
      console.log(`[finishRound] ${roomCode} — reset`);
    } catch (err) {
      console.error(`[finishRound:${roomCode}]`, err);
    } finally {
      clearTimeout(rt.timer);
      clearTimeout(rt.finishTimer);
      runtimes.delete(roomCode);
    }
  }

  // ═══════════════════════════════════════════════════════
  // RESUME — ሰርቨር እንደገና ከተነሳ በስራ ላይ ያለ ጨዋታ ይቀጥላል
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
          if (fresh) io.to(roomCode).emit("room_state", rooms.publicState(fresh));
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
        console.log(`[resume] ${roomCode} — continuing at ${rt.called.length} called`);

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
  // RECONCILER — የሰዓት ማብቂያዎችን ይከታተላል (250ms) + ትክክለኛ ታይመር ያስታጥቃል
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
          await rooms.resetToWaiting(g.roomCode); // የጎደለ ሰዓት ጠግን
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

      const active = await Game.find({ status: "active" }).select("roomCode").lean();
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

  // ቋሚ ክፍሎች ሰርቨር ሲነሳ ይፈጠራሉ — የ 50 ሰከንድ ዑደት ከመጀመሪያው ይሽከረከራል
  (async function boot() {
    try {
      for (const code of rooms.DEFAULT_ROOMS) {
        await rooms.ensureRoom(code);
        await rooms.ensureRoomCards(code);
      }
      console.log("[boot] default rooms ready");
    } catch (err) {
      console.error("[boot] failed, retrying in 3s:", err.message);
      setTimeout(boot, 3000);
    }
  })();

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
    activeUserIds.add(socket.userId);

    // ─────────── ካርቴላ መምረጫ ገጽ ሲከፈት ───────────
    socket.on("watch_room", async ({ roomCode } = {}) => {
      try {
        roomCode = rooms.normalizeRoomCode(roomCode);
        if (!roomCode) return;
        const game = await rooms.ensureRoom(roomCode);
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.emit("room_state", rooms.publicState(game));
        // ተጠቃሚው ከዚህ በፊት የያዛቸው ካርቴላዎች (ተመልሶ ሲገባ ለማሳየት)
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

    // ─────────── ካርቴላ መምረጥ (ክፍያ + ማስያዝ atomic) ───────────
    socket.on("select_card", async ({ roomCode, cardId } = {}) => {
      try {
        roomCode = rooms.normalizeRoomCode(roomCode);
        cardId = parseCardId(cardId);
        if (!roomCode || !cardId) return;

        const game = await rooms.ensureRoom(roomCode);
        const fail = (message) => socket.emit("error_message", { message, cardId });

        if (game.status !== "waiting") return fail("⏱ ምርጫው ተዘግቷል");
        const deadline = deadlineOf(game);
        if (deadline <= Date.now()) return fail("⏱ ሰዓቱ አልቋል");

        const mine = game.reservedCards.filter((r) => r.telegramId === socket.telegramId);
        if (mine.some((r) => r.cardId === cardId)) return; // አስቀድሞ የራሱ ነው
        if (mine.length >= MAX_CARDS_PER_USER)
          return fail(`❌ ቢበዛ ${MAX_CARDS_PER_USER} ካርቴላ ብቻ`);

        // 1) ክፍያ (ቀሪ ሂሳብ በቂ ከሆነ ብቻ — atomic)
        const user = await User.findOneAndUpdate(
          { _id: socket.userId, isBanned: { $ne: true }, balance: { $gte: game.entryFee } },
          { $inc: { balance: -game.entryFee } },
          { new: true }
        );
        if (!user) return fail("❌ ቀሪ ሂሳብ በቂ አይደለም");

        // 2) ካርቴላ ማስያዝ (ሌላ ሰው ካልያዘው, ሰዓቱ ካላለቀ, ከ 3 ካልበለጠ — atomic)
        const deadlineField = game.isWeeklyGame ? "scheduledStart" : "selectionEndsAt";
        const res = await Game.updateOne(
          {
            roomCode,
            status: "waiting",
            [deadlineField]: { $gt: new Date() },
            "reservedCards.cardId": { $ne: cardId },
            "players.cardId": { $ne: cardId },
            $expr: {
              $lt: [
                {
                  $size: {
                    $filter: {
                      input: "$reservedCards",
                      cond: { $eq: ["$$this.telegramId", socket.telegramId] },
                    },
                  },
                },
                MAX_CARDS_PER_USER,
              ],
            },
          },
          {
            $push: {
              reservedCards: { user: user._id, telegramId: socket.telegramId, cardId },
            },
          }
        );

        if (res.modifiedCount !== 1) {
          await refund(user._id, game.entryFee, game._id, { reason: "reserve-failed", cardId });
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
        io.to(roomCode).emit("card_selected", { cardId, telegramId: socket.telegramId });
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        console.error("[select_card]", err);
      }
    });

    // ─────────── ካርቴላ መመለስ (ገንዘብ ይመለሳል) ───────────
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
            reservedCards: { $elemMatch: { cardId, telegramId: socket.telegramId } },
          },
          { $pull: { reservedCards: { cardId, telegramId: socket.telegramId } } }
        );
        if (res.modifiedCount !== 1) return;

        await refund(socket.userId, game.entryFee, game._id, { action: "deselect", cardId });
        io.to(roomCode).emit("card_deselected", { cardId, telegramId: socket.telegramId });
      } catch (err) {
        console.error("[deselect_card]", err);
      }
    });

    // ─────────── ወደ ላይቭ ጌም መግባት / እንደገና መገናኘት ───────────
    // ይህ ክስተት ገንዘብ አይቀንስም. ተጫዋች ካርዶቹ ካሉት → state_restore;
    // ከሌለው (ዘግይቶ የመጣ) → ተመልካች (spectator) ሆኖ ቀጥታ ጨዋታውን ያያል.
    socket.on("join_room", async ({ roomCode } = {}) => {
      try {
        roomCode = rooms.normalizeRoomCode(roomCode);
        if (!roomCode) return;

        // ሰዓቱ አልቆ ጨዋታው እየተጀመረ ከሆነ እስኪጨርስ ብቻ ይጠብቃል (ሌላ መቆለፊያ የለም —
        // በሺህ የሚቆጠሩ ተጠቃሚዎች በ 0 ሰከንድ ላይ ቢገቡ ጨዋታው እንዳይዘገይ)
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

          const myCards = rt ? rt.players.filter((p) => p.userId === socket.userId) : [];

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

          // ፖፕ-አፕ እየታየ ከሆነ ለዘገየው ተጠቃሚም ቀሪውን ጊዜ ያሳይ
          if (rt?.result) {
            const left = WINNER_DISPLAY_MS - (Date.now() - rt.result.shownAt);
            if (left > 200) {
              socket.emit("bingo_claimed", { ...rt.result.payload, displayMs: left });
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
      const stillConnected = [...io.sockets.sockets.values()].some(
        (s) => s.id !== socket.id && s.userId === socket.userId
      );
      if (!stillConnected) activeUserIds.delete(socket.userId);
    });
  });
}

module.exports = { initGameSocket, getActiveUserCount };
