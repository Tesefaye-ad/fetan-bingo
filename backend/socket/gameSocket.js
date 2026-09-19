const Game = require("../models/Game");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { generate1000Cards, checkWin, markNumber } = require("../utils/bingoCard");
const { verifySocketToken } = require("../middleware/auth");

const activeCallers = new Map();
const activeUserIds = new Set();
const joinGuards = new Map();

function getActiveUserCount() {
  return activeUserIds.size;
}

function randomUncalled(called, max) {
  const set = new Set(called);
  const pool = [];
  for (let i = 1; i <= max; i++) if (!set.has(i)) pool.push(i);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function stopCaller(roomCode) {
  const h = activeCallers.get(roomCode);
  if (h) {
    clearTimeout(h);
    activeCallers.delete(roomCode);
    console.log(`[caller:${roomCode}] stopped`);
  }
}

function getNextWeeklyStart(fee) {
  const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const et = new Date(now.getTime() + ETHIOPIA_OFFSET_MS);
  const targetDay = 6;
  const targetHour = 0;
  const targetMinute = fee === 50 ? 0 : 5;
  let daysUntil = (targetDay - et.getUTCDay() + 7) % 7;
  if (daysUntil === 0) {
    const today = new Date(et);
    today.setUTCHours(targetHour, targetMinute, 0, 0);
    if (et >= today) daysUntil = 7;
  }
  const next = new Date(et);
  next.setUTCDate(next.getUTCDate() + daysUntil);
  next.setUTCHours(targetHour, targetMinute, 0, 0);
  return new Date(next.getTime() - ETHIOPIA_OFFSET_MS);
}

function isWeeklyRoom(roomCode) {
  return roomCode === "ROOM50" || roomCode === "ROOM100";
}

function getWeeklyFee(roomCode) {
  return roomCode === "ROOM50" ? 50 : 100;
}

function buildRoomState(game) {
  return {
    roomCode: game.roomCode,
    status: game.status,
    playerCount: game.players.length,
    prizePool: game.prizePool,
    entryFee: game.entryFee,
    calledNumbers: game.calledNumbers,
    takenCards: game.players.map((p) => p.cardId),
    reservedCards: (game.reservedCards || []).map((r) => r.cardId),
    selectionEndsAt: game.selectionEndsAt,
    scheduledStart: game.scheduledStart,
    isWeeklyGame: game.isWeeklyGame || false,
  };
}

function initGameSocket(io) {
  const MIN_PLAYERS = Number(process.env.MIN_PLAYERS ?? 0);
  const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 1000);
  const CALL_INTERVAL_MS = Number(process.env.CALL_INTERVAL_MS || 2000);
  const NEXT_GAME_DELAY_MS = Number(process.env.NEXT_GAME_DELAY_MS || 15000);
  const SELECTION_TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);

  console.log(`[init] SELECTION_TIMER_MS=${SELECTION_TIMER_MS}ms (${SELECTION_TIMER_MS / 1000}s)`);

  io.use((socket, next) => {
    const payload = verifySocketToken(socket.handshake.auth?.token);
    if (!payload) return next(new Error("unauthorized"));
    socket.userId = payload.userId;
    socket.telegramId = payload.telegramId;
    next();
  });

  // ═══════════════════════════════════════════════════════
  // AUTO-STARTER
  // ═══════════════════════════════════════════════════════
  setInterval(async () => {
    try {
      const regular = await Game.find({ status: "waiting", isWeeklyGame: false });
      for (const g of regular) {
        if (g.selectionEndsAt && new Date(g.selectionEndsAt) < new Date()) {
          console.log(`[auto-starter] timer expired → start ${g.roomCode}`);
          startGame(io, g.roomCode, CALL_INTERVAL_MS, NEXT_GAME_DELAY_MS, SELECTION_TIMER_MS);
        }
      }

      const weekly = await Game.find({ status: "waiting", isWeeklyGame: true });
      for (const g of weekly) {
        if (g.scheduledStart && new Date(g.scheduledStart) <= new Date()) {
          console.log(`[auto-starter] weekly time → start ${g.roomCode}`);
          startGame(io, g.roomCode, CALL_INTERVAL_MS, NEXT_GAME_DELAY_MS, SELECTION_TIMER_MS);
        }
      }

      // Clean stale active games (> 3 min)
      const stale = await Game.find({
        status: "active",
        startedAt: { $lt: new Date(Date.now() - 3 * 60 * 1000) },
      });
      for (const g of stale) {
        console.log(`[auto-starter] stale reset ${g.roomCode}`);
        stopCaller(g.roomCode);
        g.status = "waiting";
        g.calledNumbers = [];
        g.prizePool = 0;
        g.winners = [];
        g.winningCartelas = [];
        g.players = [];
        g.reservedCards = [];
        g.startedAt = undefined;
        g.finishedAt = undefined;
        if (g.isWeeklyGame) {
          g.scheduledStart = getNextWeeklyStart(getWeeklyFee(g.roomCode));
          g.selectionEndsAt = undefined;
        } else {
          g.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
        }
        await g.save();
      }
    } catch (err) {
      console.error("[auto-starter]", err.message);
    }
  }, 3000);

  io.on("connection", (socket) => {
    console.log(`[socket] connected ${socket.telegramId}`);
    activeUserIds.add(socket.userId);

    // ═══════════════════════════════════════════════════════
    // SELECT CARD (reserve)
    // ═══════════════════════════════════════════════════════
    socket.on("select_card", async ({ roomCode, cardId }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "waiting") return;

        const user = await User.findById(socket.userId);
        if (!user) return;

        const taken = game.players.some((p) => p.cardId === cardId);
        const reservedByOther = (game.reservedCards || []).some(
          (r) => r.cardId === cardId && String(r.telegramId) !== String(socket.telegramId)
        );
        const alreadyMine = (game.reservedCards || []).some(
          (r) => r.cardId === cardId && String(r.telegramId) === String(socket.telegramId)
        );

        if (taken || reservedByOther) {
          return socket.emit("error_message", { message: `❌ ካርድ #${cardId} ተይዟል!` });
        }
        if (alreadyMine) return;

        if (user.balance < game.entryFee) {
          return socket.emit("error_message", { message: "Insufficient balance" });
        }

        user.balance -= game.entryFee;
        await user.save();
        await Transaction.create({
          user: user._id,
          type: "entry_fee",
          amount: game.entryFee,
          balanceAfter: user.balance,
          game: game._id,
          meta: { action: "reserve", cardId },
        });

        if (!game.reservedCards) game.reservedCards = [];
        game.reservedCards.push({ user: user._id, telegramId: socket.telegramId, cardId });
        await game.save();

        io.to(roomCode).emit("card_selected", { cardId, telegramId: socket.telegramId });
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        console.error("[select_card]", err);
      }
    });

    socket.on("deselect_card", async ({ roomCode, cardId }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "waiting") return;

        const user = await User.findById(socket.userId);
        if (!user) return;

        const idx = (game.reservedCards || []).findIndex(
          (r) => r.cardId === cardId && String(r.telegramId) === String(socket.telegramId)
        );
        if (idx === -1) return;

        user.balance += game.entryFee;
        await user.save();
        await Transaction.create({
          user: user._id,
          type: "refund",
          amount: game.entryFee,
          balanceAfter: user.balance,
          game: game._id,
          meta: { action: "deselect", cardId },
        });

        game.reservedCards.splice(idx, 1);
        await game.save();

        io.to(roomCode).emit("card_deselected", { cardId, telegramId: socket.telegramId });
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        console.error("[deselect_card]", err);
      }
    });

    // ═══════════════════════════════════════════════════════
    // 👈 JOIN ROOM — NEVER touches selectionEndsAt
    // ═══════════════════════════════════════════════════════
    socket.on("join_room", async ({ roomCode, cardIds }) => {
      try {
        if (!roomCode) return;
        roomCode = String(roomCode).trim().toUpperCase();

        const selectedIds = Array.isArray(cardIds) ? cardIds : cardIds ? [cardIds] : [];

        const guard = `${socket.id}:${roomCode}`;
        if (joinGuards.has(guard)) return;
        joinGuards.set(guard, true);
        setTimeout(() => joinGuards.delete(guard), 3000);

        let game = await Game.findOne({ roomCode });

        // ══════════════════════════════════════════════════
        // 👈 CREATE ROOM ONLY IF MISSING
        // selectionEndsAt is set HERE and NOWHERE ELSE
        // ══════════════════════════════════════════════════
        if (!game) {
          const weekly = isWeeklyRoom(roomCode);
          const fee = weekly ? getWeeklyFee(roomCode) : 10;

          const newGame = {
            roomCode,
            entryFee: Number(process.env.ENTRY_FEE || fee),
            maxNumber: Number(process.env.BINGO_MAX_NUMBER || 75),
            allCards: generate1000Cards(),
            isWeeklyGame: weekly,
            status: "waiting",
          };

          if (weekly) {
            newGame.scheduledStart = getNextWeeklyStart(fee);
            console.log(
              `[join_room] CREATE ${roomCode} (weekly) scheduled=${newGame.scheduledStart.toISOString()}`
            );
          } else {
            newGame.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
            console.log(
              `[join_room] CREATE ${roomCode} selectionEndsAt=${newGame.selectionEndsAt.toISOString()} (${SELECTION_TIMER_MS / 1000}s)`
            );
          }

          game = await Game.create(newGame);
        } else {
          // ══════════════════════════════════════════════
          // 👈 ROOM EXISTS → NEVER touch selectionEndsAt
          // ══════════════════════════════════════════════
          const remaining = game.selectionEndsAt
            ? Math.max(0, Math.floor((new Date(game.selectionEndsAt) - Date.now()) / 1000))
            : "N/A";
          console.log(
            `[join_room] EXISTS ${roomCode} selectionEndsAt=${game.selectionEndsAt?.toISOString()} remaining=${remaining}s (UNCHANGED)`
          );

          if (!game.allCards?.length) {
            game.allCards = generate1000Cards();
            await game.save();
          }
        }

        const user = await User.findById(socket.userId);
        if (!user) return;

        const existing = game.players.filter((p) => p.user.toString() === socket.userId);

        // Watching mode
        const watchingMode =
          (game.status === "active" || game.status === "finished") && existing.length === 0;
        if (watchingMode || selectedIds.length === 0) {
          if (existing.length > 0) {
            socket.join(roomCode);
            socket.data.roomCode = roomCode;
            socket.data.watching = false;
            socket.emit("your_cards", {
              cards: existing.map((p) => p.card),
              markedCards: existing.map((p) => p.marked),
              cardIds: existing.map((p) => p.cardId),
            });
            io.to(roomCode).emit("room_state", buildRoomState(game));
            return;
          }
          socket.join(roomCode);
          socket.data.roomCode = roomCode;
          socket.data.watching = true;
          socket.emit("watching_mode", { roomCode });
          socket.emit("your_cards", { cards: [], markedCards: [], cardIds: [] });
          io.to(roomCode).emit("room_state", buildRoomState(game));
          return;
        }

        // Join as player
        if (existing.length === 0) {
          if (game.players.length >= MAX_PLAYERS) {
            return socket.emit("error_message", { message: `Room full (${MAX_PLAYERS} max)` });
          }

          const takenSet = new Set(game.players.map((p) => p.cardId));
          const newCards = [];
          const newMarked = [];
          const newIds = [];

          for (const cid of selectedIds) {
            const id = parseInt(cid, 10);
            if (!id || id < 1 || id > 1000 || takenSet.has(id)) continue;

            const cardData = game.allCards.find((c) => c.cardId === id);
            if (!cardData) continue;

            const reserved = (game.reservedCards || []).find(
              (r) => r.cardId === id && String(r.telegramId) === String(socket.telegramId)
            );

            if (!reserved) {
              if (user.balance < game.entryFee) {
                socket.join(roomCode);
                socket.data.roomCode = roomCode;
                socket.data.watching = true;
                socket.emit("watching_mode", { roomCode });
                socket.emit("your_cards", { cards: [], markedCards: [], cardIds: [] });
                io.to(roomCode).emit("room_state", buildRoomState(game));
                return;
              }
              user.balance -= game.entryFee;
              await Transaction.create({
                user: user._id,
                type: "entry_fee",
                amount: game.entryFee,
                balanceAfter: user.balance,
                game: game._id,
                meta: { cardId: id },
              });
            }

            game.players.push({
              user: user._id,
              telegramId: socket.telegramId,
              cardId: cardData.cardId,
              card: cardData.card,
              marked: cardData.marked.map((r) => [...r]),
              hasWon: false,
            });

            game.prizePool += Math.floor(game.entryFee * 0.8);
            takenSet.add(id);

            newCards.push(cardData.card);
            newMarked.push(cardData.marked.map((r) => [...r]));
            newIds.push(cardData.cardId);
          }

          game.reservedCards = (game.reservedCards || []).filter(
            (r) => String(r.telegramId) !== String(socket.telegramId)
          );

          if (newCards.length === 0) {
            socket.join(roomCode);
            socket.data.roomCode = roomCode;
            socket.data.watching = true;
            socket.emit("watching_mode", { roomCode });
            socket.emit("your_cards", { cards: [], markedCards: [], cardIds: [] });
            io.to(roomCode).emit("room_state", buildRoomState(game));
            return;
          }

          await user.save();
          await game.save();

          socket.join(roomCode);
          socket.data.roomCode = roomCode;
          socket.data.watching = false;
          socket.emit("balance_update", { balance: user.balance });
          socket.emit("your_cards", { cards: newCards, markedCards: newMarked, cardIds: newIds });
          io.to(roomCode).emit("room_state", buildRoomState(game));
          return;
        }

        // Already a player — re-send
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.watching = false;
        socket.emit("your_cards", {
          cards: existing.map((p) => p.card),
          markedCards: existing.map((p) => p.marked),
          cardIds: existing.map((p) => p.cardId),
        });
        io.to(roomCode).emit("room_state", buildRoomState(game));
      } catch (err) {
        console.error("[join_room]", err);
      }
    });

    // ═══════════════════════════════════════════════════════
    // MARK CELL
    // ═══════════════════════════════════════════════════════
    socket.on("mark_cell", async ({ roomCode, row, col }) => {
      try {
        if (row < 0 || row > 4 || col < 0 || col > 4) return;
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "active") return;

        const userPlayers = game.players.filter((p) => p.user.toString() === socket.userId);
        if (!userPlayers.length) return;

        for (const p of userPlayers) {
          const num = p.card[row][col];
          if (num === 0 || game.calledNumbers.includes(num)) p.marked[row][col] = true;
        }
        game.markModified("players");
        await game.save();
      } catch (err) {
        console.error("[mark_cell]", err);
      }
    });

    // ═══════════════════════════════════════════════════════
    // CLAIM BINGO
    // ═══════════════════════════════════════════════════════
    socket.on("claim_bingo", async ({ roomCode }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "active") {
          return socket.emit("error_message", { message: "No active game" });
        }

        const user = await User.findById(socket.userId);
        if (!user) return;

        const userPlayers = game.players.filter((p) => p.user.toString() === socket.userId);
        const valid = [];

        for (const p of userPlayers) {
          if (p.hasWon) continue;
          const pattern = checkWin(p.marked);
          if (pattern) {
            p.hasWon = true;
            valid.push({ player: p, pattern });
          }
        }

        if (!valid.length) {
          return socket.emit("bingo_rejected", { message: "Not valid bingo yet" });
        }

        game.markModified("players");
        if (!game.winningCartelas) game.winningCartelas = [];
        if (!game.winners) game.winners = [];

        for (const { player, pattern } of valid) {
          game.winningCartelas.push({
            telegramId: socket.telegramId,
            name: user.username || user.firstName || "Player",
            cardId: player.cardId,
            pattern,
            card: player.card,
            marked: player.marked,
          });
          if (!game.winners.some((w) => w.toString() === user._id.toString())) {
            game.winners.push(user._id);
          }
        }

        const totalCartelas = game.winningCartelas.length;
        const prizePerCartela = Math.floor(game.prizePool / totalCartelas);
        const userPrize = prizePerCartela * valid.length;

        user.balance += userPrize;
        user.gamesWon += valid.length;
        user.totalWinnings = (user.totalWinnings || 0) + userPrize;
        await user.save();

        await Transaction.create({
          user: user._id,
          type: "prize",
          amount: userPrize,
          balanceAfter: user.balance,
          game: game._id,
          meta: { cartelaCount: valid.length },
        });

        socket.emit("balance_update", { balance: user.balance });
        await game.save();

        io.to(roomCode).emit("bingo_claimed", {
          winners: game.winningCartelas.map((w) => ({
            telegramId: w.telegramId,
            name: w.name,
            cardId: w.cardId,
            pattern: w.pattern,
            card: w.card,
            marked: w.marked,
          })),
          prizePool: game.prizePool,
        });

        setTimeout(() => finishGame(io, roomCode, NEXT_GAME_DELAY_MS, SELECTION_TIMER_MS), 2000);
      } catch (err) {
        console.error("[claim_bingo]", err);
      }
    });

    socket.on("leave_room", () => {
      if (socket.data.roomCode) socket.leave(socket.data.roomCode);
    });

    socket.on("disconnect", () => {
      const stillConnected = [...io.sockets.sockets.values()].some(
        (s) => s.userId === socket.userId
      );
      if (!stillConnected) activeUserIds.delete(socket.userId);
    });
  });

  // ═══════════════════════════════════════════════════════
  // START GAME
  // ═══════════════════════════════════════════════════════
  async function startGame(io, roomCode, intervalMs, nextDelayMs, timerMs) {
    const game = await Game.findOne({ roomCode });
    if (!game || game.status !== "waiting") return;

    game.status = "active";
    game.startedAt = new Date();
    game.calledNumbers = [];
    game.winners = [];
    game.winningCartelas = [];
    game.selectionEndsAt = undefined;
    await game.save();

    io.to(roomCode).emit("game_started", { roomCode });
    console.log(`[caller:${roomCode}] STARTED (${intervalMs}ms interval)`);

    let active = true;

    const runCaller = async () => {
      if (!active) {
        activeCallers.delete(roomCode);
        return;
      }
      try {
        const g = await Game.findOne({ roomCode });
        if (!g || g.status !== "active") {
          active = false;
          activeCallers.delete(roomCode);
          return;
        }

        const num = randomUncalled(g.calledNumbers, g.maxNumber);
        if (num === null) {
          active = false;
          activeCallers.delete(roomCode);
          return finishGame(io, roomCode, nextDelayMs, timerMs);
        }

        g.calledNumbers.push(num);
        for (const p of g.players) markNumber(p.card, p.marked, num);
        g.markModified("players");
        g.markModified("calledNumbers");
        await g.save();

        console.log(`[caller:${roomCode}] CALLED ${num} (${g.calledNumbers.length}/75)`);

        const grouped = {};
        for (const p of g.players) {
          const uid = p.user.toString();
          if (!grouped[uid]) grouped[uid] = { cards: [], markedCards: [], cardIds: [] };
          grouped[uid].cards.push(p.card);
          grouped[uid].markedCards.push(p.marked);
          grouped[uid].cardIds.push(p.cardId);
        }
        for (const s of io.sockets.sockets.values()) {
          if (s.userId && grouped[s.userId]) s.emit("your_cards", grouped[s.userId]);
        }

        io.to(roomCode).emit("number_called", {
          number: num,
          calledNumbers: g.calledNumbers,
        });
      } catch (err) {
        console.error(`[caller:${roomCode}]`, err);
      }
      if (active) {
        const h = setTimeout(runCaller, intervalMs);
        activeCallers.set(roomCode, h);
      }
    };

    const initial = setTimeout(runCaller, intervalMs);
    activeCallers.set(roomCode, initial);
  }

  // ═══════════════════════════════════════════════════════
  // FINISH GAME
  // ═══════════════════════════════════════════════════════
  async function finishGame(io, roomCode, nextDelayMs, timerMs) {
    const game = await Game.findOne({ roomCode });
    if (!game) return;
    stopCaller(roomCode);

    game.status = "finished";
    game.finishedAt = new Date();
    await game.save();

    for (const p of game.players) {
      await User.findByIdAndUpdate(p.user, { $inc: { gamesPlayed: 1 } });
    }

    io.to(roomCode).emit("game_over", {
      winners: (game.winningCartelas || []).map((w) => ({
        telegramId: w.telegramId,
        name: w.name,
        cardId: w.cardId,
        pattern: w.pattern,
        card: w.card,
        marked: w.marked,
      })),
      prizePool: game.prizePool,
      nextGameAt: new Date(Date.now() + nextDelayMs),
    });

    setTimeout(async () => {
      const fresh = await Game.findOne({ roomCode });
      if (!fresh) return;
      fresh.status = "waiting";
      fresh.calledNumbers = [];
      fresh.prizePool = 0;
      fresh.winners = [];
      fresh.winningCartelas = [];
      fresh.players = [];
      fresh.reservedCards = [];
      fresh.startedAt = undefined;
      fresh.finishedAt = undefined;

      if (fresh.isWeeklyGame) {
        fresh.scheduledStart = getNextWeeklyStart(getWeeklyFee(fresh.roomCode));
        fresh.selectionEndsAt = undefined;
      } else {
        fresh.selectionEndsAt = new Date(Date.now() + timerMs);
        console.log(`[finishGame] ${roomCode} RESET → new timer ${timerMs / 1000}s`);
      }
      await fresh.save();

      io.to(roomCode).emit("next_game_ready", { roomCode });
      io.to(roomCode).emit("room_state", buildRoomState(fresh));
    }, nextDelayMs);
  }
}

module.exports = { initGameSocket, getActiveUserCount };