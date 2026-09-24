const Game = require("../models/Game");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const {
  generate1250Cards,
  TOTAL_CARDS,
  checkWin,
  markNumber,
  getPatternForRoom,
} = require("../utils/bingoCard");
const auth = require("../routes/auth");
const { verifySocketToken } = auth;

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
    winPattern: game.winPattern || "any-row",
  };
}

function initGameSocket(io) {
  const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 1000);
  const CALL_INTERVAL_MS = 800; // 👈 ፈጣን ጥሪ
  const SELECTION_TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);
  const WINNER_DISPLAY_MS = 5000; // 👈 5 ሰከንድ ማሳያ
  const FIRST_CALL_DELAY_MS = 200; // 👈 ፈጣን መጀመር

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
      const regular = await Game.find({
        status: "waiting",
        isWeeklyGame: false,
      });
      for (const g of regular) {
        if (
          g.selectionEndsAt &&
          new Date(g.selectionEndsAt) < new Date() &&
          !activeCallers.has(g.roomCode)
        ) {
          startGame(io, g.roomCode);
        }
      }
      const weekly = await Game.find({ status: "waiting", isWeeklyGame: true });
      for (const g of weekly) {
        if (
          g.scheduledStart &&
          new Date(g.scheduledStart) <= new Date() &&
          !activeCallers.has(g.roomCode)
        ) {
          startGame(io, g.roomCode);
        }
      }
      // Stale cleanup
      const stale = await Game.find({
        status: "active",
        startedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) },
      });
      for (const g of stale) {
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
        g.winPattern = getPatternForRoom(g.entryFee);
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
  }, 2000);

  io.on("connection", (socket) => {
    activeUserIds.add(socket.userId);

    // ═══════════════════════════════════════════════════
    // SELECT CARD
    // ═══════════════════════════════════════════════════
    socket.on("select_card", async ({ roomCode, cardId }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "waiting") return;
        const user = await User.findById(socket.userId);
        if (!user) return;

        const taken = game.players.some((p) => p.cardId === cardId);
        const reservedByOther = (game.reservedCards || []).some(
          (r) =>
            r.cardId === cardId &&
            String(r.telegramId) !== String(socket.telegramId)
        );
        const alreadyMine = (game.reservedCards || []).some(
          (r) =>
            r.cardId === cardId &&
            String(r.telegramId) === String(socket.telegramId)
        );

        if (taken || reservedByOther) {
          return socket.emit("error_message", {
            message: `❌ Card #${cardId} taken!`,
          });
        }
        if (alreadyMine) return;
        if (user.balance < game.entryFee) {
          return socket.emit("error_message", {
            message: `❌ Insufficient balance!`,
          });
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
        game.reservedCards.push({
          user: user._id,
          telegramId: socket.telegramId,
          cardId,
        });
        await game.save();

        io.to(roomCode).emit("card_selected", {
          cardId,
          telegramId: socket.telegramId,
        });
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
          (r) =>
            r.cardId === cardId &&
            String(r.telegramId) === String(socket.telegramId)
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
        io.to(roomCode).emit("card_deselected", {
          cardId,
          telegramId: socket.telegramId,
        });
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        console.error("[deselect_card]", err);
      }
    });

    // ═══════════════════════════════════════════════════
    // JOIN ROOM
    // ═══════════════════════════════════════════════════
    socket.on("join_room", async ({ roomCode, cardIds, spectate }) => {
      try {
        if (!roomCode) return;
        roomCode = String(roomCode).trim().toUpperCase();
        const selectedIds = Array.isArray(cardIds)
          ? cardIds
          : cardIds
          ? [cardIds]
          : [];

        const guard = `${socket.id}:${roomCode}`;
        if (joinGuards.has(guard)) return;
        joinGuards.set(guard, true);
        setTimeout(() => joinGuards.delete(guard), 3000);

        let game = await Game.findOne({ roomCode });

        if (!game) {
          const weekly = isWeeklyRoom(roomCode);
          const fee = weekly
            ? getWeeklyFee(roomCode)
            : Number(process.env.ENTRY_FEE || 10);
          const newGame = {
            roomCode,
            entryFee: fee,
            maxNumber: 75,
            allCards: generate1250Cards(),
            isWeeklyGame: weekly,
            status: "waiting",
            winPattern: getPatternForRoom(fee),
          };
          if (weekly) {
            newGame.scheduledStart = getNextWeeklyStart(fee);
          } else {
            newGame.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
          }
          game = await Game.create(newGame);
        } else if (
          !game.allCards?.length ||
          game.allCards.length < TOTAL_CARDS
        ) {
          game.allCards = generate1250Cards();
          await game.save();
        }

        const user = await User.findById(socket.userId);
        if (!user) return;

        const existing = game.players.filter(
          (p) => p.user.toString() === socket.userId
        );

        const isSpectator =
          spectate === true ||
          (selectedIds.length === 0 && existing.length === 0);

        // Reconnect
        if (existing.length > 0) {
          socket.join(roomCode);
          socket.data.roomCode = roomCode;
          socket.data.isSpectator = false;
          socket.emit("state_restore", {
            roomCode,
            status: game.status,
            calledNumbers: game.calledNumbers,
            winPattern: game.winPattern,
            prizePool: game.prizePool,
            playerCount: game.players.length,
            entryFee: game.entryFee,
            cards: existing.map((p) => ({
              cardId: p.cardId,
              card: p.card,
              marked: p.marked,
            })),
          });
          io.to(roomCode).emit("room_state", buildRoomState(game));
          return;
        }

        // Spectator
        if (isSpectator) {
          socket.join(roomCode);
          socket.data.roomCode = roomCode;
          socket.data.isSpectator = true;
          socket.emit("spectator_mode", {
            roomCode,
            status: game.status,
            calledNumbers: game.calledNumbers || [],
            winPattern: game.winPattern || "any-row",
            prizePool: game.prizePool || 0,
            playerCount: game.players.length,
            entryFee: game.entryFee,
          });
          io.to(roomCode).emit("room_state", buildRoomState(game));
          return;
        }

        // Active game — spectator
        if (game.status === "active" || game.status === "finished") {
          socket.join(roomCode);
          socket.data.roomCode = roomCode;
          socket.data.isSpectator = true;
          socket.emit("error_message", {
            message: "🎯 Game started — watching as spectator",
          });
          socket.emit("spectator_mode", {
            roomCode,
            status: game.status,
            calledNumbers: game.calledNumbers || [],
            winPattern: game.winPattern,
            prizePool: game.prizePool,
            playerCount: game.players.length,
            entryFee: game.entryFee,
          });
          io.to(roomCode).emit("room_state", buildRoomState(game));
          return;
        }

        if (game.players.length >= MAX_PLAYERS) {
          return socket.emit("error_message", { message: "Room full" });
        }

        const takenSet = new Set(game.players.map((p) => p.cardId));
        const newCards = [],
          newMarked = [],
          newIds = [];

        for (const cid of selectedIds) {
          const id = parseInt(cid, 10);
          if (!id || id < 1 || id > TOTAL_CARDS || takenSet.has(id)) continue;
          const cardData = game.allCards.find((c) => c.cardId === id);
          if (!cardData) continue;

          const reserved = (game.reservedCards || []).find(
            (r) =>
              r.cardId === id &&
              String(r.telegramId) === String(socket.telegramId)
          );

          if (!reserved) {
            if (user.balance < game.entryFee) {
              socket.join(roomCode);
              socket.data.roomCode = roomCode;
              socket.data.isSpectator = true;
              socket.emit("error_message", {
                message: `❌ Insufficient balance — watching`,
              });
              socket.emit("spectator_mode", {
                roomCode,
                status: game.status,
                calledNumbers: game.calledNumbers || [],
                winPattern: game.winPattern,
                prizePool: game.prizePool,
                playerCount: game.players.length,
                entryFee: game.entryFee,
              });
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
          socket.data.isSpectator = true;
          socket.emit("spectator_mode", {
            roomCode,
            status: game.status,
            calledNumbers: game.calledNumbers || [],
            winPattern: game.winPattern,
            prizePool: game.prizePool,
            playerCount: game.players.length,
            entryFee: game.entryFee,
          });
          io.to(roomCode).emit("room_state", buildRoomState(game));
          return;
        }

        await user.save();
        await game.save();
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.isSpectator = false;
        socket.emit("balance_update", { balance: user.balance });
        socket.emit("your_cards", {
          cards: newCards,
          markedCards: newMarked,
          cardIds: newIds,
        });
        io.to(roomCode).emit("room_state", buildRoomState(game));
      } catch (err) {
        console.error("[join_room]", err);
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
  // AUTO-DETECT WINNERS
  // ═══════════════════════════════════════════════════════
  async function autoDetectWinners(io, game) {
    const targetPattern = game.winPattern || "any-row";
    const winners = [];

    for (const p of game.players) {
      if (p.hasWon) continue;
      const result = checkWin(p.marked, targetPattern);
      if (result) {
        p.hasWon = true;
        winners.push({ player: p, pattern: result });
      }
    }

    if (!winners.length) return false;

    game.markModified("players");
    await processWinners(io, game, winners);
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // PROCESS WINNERS + 5s DISPLAY + AUTO RESET
  // ═══════════════════════════════════════════════════════
  async function processWinners(io, game, winners) {
    stopCaller(game.roomCode);

    if (!game.winningCartelas) game.winningCartelas = [];
    if (!game.winners) game.winners = [];

    for (const { player, pattern } of winners) {
      const playerUser = await User.findById(player.user);
      if (!playerUser) continue;

      game.winningCartelas.push({
        userId: playerUser._id.toString(),
        telegramId: player.telegramId || String(playerUser.telegramId),
        name: playerUser.username || playerUser.firstName || "Player",
        cardId: player.cardId,
        pattern,
        card: player.card,
        marked: player.marked,
      });

      if (
        !game.winners.some((w) => w.toString() === playerUser._id.toString())
      ) {
        game.winners.push(playerUser._id);
      }
    }
    await game.save();

    const totalCartelas = game.winningCartelas.length;
    const prizePerCartela = Math.floor(game.prizePool / totalCartelas);
    const userPrizeMap = {};
    for (const wc of game.winningCartelas) {
      userPrizeMap[wc.telegramId] =
        (userPrizeMap[wc.telegramId] || 0) + prizePerCartela;
    }

    const winnersPanelData = [];
    for (const tgId of Object.keys(userPrizeMap)) {
      const user = await User.findOne({ telegramId: tgId });
      if (!user) continue;

      const prize = userPrizeMap[tgId];
      const cartelaCount = game.winningCartelas.filter(
        (w) => w.telegramId === tgId
      ).length;

      user.balance += prize;
      user.gamesWon += cartelaCount;
      user.totalWinnings = (user.totalWinnings || 0) + prize;
      await user.save();

      await Transaction.create({
        user: user._id,
        type: "prize",
        amount: prize,
        balanceAfter: user.balance,
        game: game._id,
      });

      for (const s of io.sockets.sockets.values()) {
        if (String(s.telegramId) === String(tgId)) {
          s.emit("balance_update", { balance: user.balance });
        }
      }

      winnersPanelData.push({
        userId: user._id.toString(),
        telegramId: tgId,
        name: user.username || user.firstName || "Player",
        cartelas: game.winningCartelas
          .filter((w) => w.telegramId === tgId)
          .map((w) => w.cardId),
        prize,
        newBalance: user.balance,
      });
    }

    // 👈 Emit BINGO popup
    io.to(game.roomCode).emit("bingo_claimed", {
      winPattern: game.winPattern,
      prizePool: game.prizePool,
      prizePerCartela,
      totalCartelas,
      winners: winnersPanelData,
      winningCartelas: game.winningCartelas.map((w) => ({
        telegramId: w.telegramId,
        name: w.name,
        cardId: w.cardId,
        subPattern: w.pattern,
        card: w.card,
        marked: w.marked,
      })),
    });

    // 👈 5 ሰከንድ ቆይቶ reset
    setTimeout(async () => {
      const fresh = await Game.findOne({ roomCode: game.roomCode });
      if (!fresh) return;

      fresh.status = "finished";
      fresh.finishedAt = new Date();
      await fresh.save();

      for (const p of fresh.players) {
        await User.findByIdAndUpdate(p.user, { $inc: { gamesPlayed: 1 } });
      }

      io.to(game.roomCode).emit("game_over", {
        winners: (fresh.winningCartelas || []).map((w) => ({
          telegramId: w.telegramId,
          name: w.name,
          cardId: w.cardId,
          pattern: w.pattern,
          card: w.card,
          marked: w.marked,
        })),
        totalWinners: (fresh.winningCartelas || []).length,
        prizePool: fresh.prizePool,
        winPattern: fresh.winPattern,
        nextGameAt: new Date(Date.now() + 500),
      });

      // Reset room
      fresh.status = "waiting";
      fresh.calledNumbers = [];
      fresh.prizePool = 0;
      fresh.winners = [];
      fresh.winningCartelas = [];
      fresh.players = [];
      fresh.reservedCards = [];
      fresh.startedAt = undefined;
      fresh.finishedAt = undefined;
      fresh.winPattern = getPatternForRoom(fresh.entryFee);

      if (fresh.isWeeklyGame) {
        fresh.scheduledStart = getNextWeeklyStart(getWeeklyFee(fresh.roomCode));
        fresh.selectionEndsAt = undefined;
      } else {
        fresh.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
      }
      await fresh.save();

      io.to(game.roomCode).emit("next_game_ready", {
        roomCode: game.roomCode,
      });
      io.to(game.roomCode).emit("room_state", buildRoomState(fresh));
    }, WINNER_DISPLAY_MS);
  }

  // ═══════════════════════════════════════════════════════
  // START GAME
  // ═══════════════════════════════════════════════════════
  async function startGame(io, roomCode) {
    // Guard ድግግሞሽ
    if (activeCallers.has(roomCode)) return;
    activeCallers.set(roomCode, null);

    try {
      const game = await Game.findOne({ roomCode });
      if (!game || game.status !== "waiting") {
        activeCallers.delete(roomCode);
        return;
      }

      game.status = "active";
      game.startedAt = new Date();
      game.calledNumbers = [];
      game.winners = [];
      game.winningCartelas = [];
      game.winPattern = getPatternForRoom(game.entryFee);
      game.selectionEndsAt = undefined;
      await game.save();

      // 👈 Game started event
      io.to(roomCode).emit("game_started", {
        roomCode,
        winPattern: game.winPattern,
      });

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
            return finishGame(io, roomCode);
          }

          // Duplicate guard
          if (g.calledNumbers.includes(num)) {
            const h = setTimeout(runCaller, CALL_INTERVAL_MS);
            activeCallers.set(roomCode, h);
            return;
          }

          g.calledNumbers.push(num);
          for (const p of g.players) markNumber(p.card, p.marked, num);
          g.markModified("players");
          g.markModified("calledNumbers");
          await g.save();

          const letter =
            num <= 15
              ? "B"
              : num <= 30
              ? "I"
              : num <= 45
              ? "N"
              : num <= 60
              ? "G"
              : "O";

          // Auto-mark ለተጫዋቾች
          const grouped = {};
          for (const p of g.players) {
            const uid = p.user.toString();
            if (!grouped[uid])
              grouped[uid] = { cards: [], markedCards: [], cardIds: [] };
            grouped[uid].cards.push(p.card);
            grouped[uid].markedCards.push(p.marked);
            grouped[uid].cardIds.push(p.cardId);
          }
          for (const s of io.sockets.sockets.values()) {
            if (s.userId && grouped[s.userId]) {
              s.emit("your_cards", grouped[s.userId]);
            }
          }

          // Number called broadcast
          io.to(roomCode).emit("number_called", {
            number: num,
            letter,
            calledNumbers: g.calledNumbers,
            winPattern: g.winPattern,
          });

          // Auto-detect winners
          const hasWinner = await autoDetectWinners(io, g);
          if (hasWinner) {
            active = false;
            activeCallers.delete(roomCode);
            return;
          }
        } catch (err) {
          console.error(`[caller:${roomCode}]`, err);
        }

        if (active) {
          const h = setTimeout(runCaller, CALL_INTERVAL_MS);
          activeCallers.set(roomCode, h);
        }
      };

      // 👈 ፈጣን መጀመር (500ms)
      const initial = setTimeout(runCaller, FIRST_CALL_DELAY_MS);
      activeCallers.set(roomCode, initial);
    } catch (err) {
      console.error(`[startGame:${roomCode}]`, err);
      activeCallers.delete(roomCode);
    }
  }

  // ═══════════════════════════════════════════════════════
  // FINISH GAME (draw — all called)
  // ═══════════════════════════════════════════════════════
  async function finishGame(io, roomCode) {
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
      winners: [],
      totalWinners: 0,
      prizePool: game.prizePool,
      winPattern: game.winPattern,
      nextGameAt: new Date(Date.now() + WINNER_DISPLAY_MS),
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
      fresh.winPattern = getPatternForRoom(fresh.entryFee);

      if (fresh.isWeeklyGame) {
        fresh.scheduledStart = getNextWeeklyStart(getWeeklyFee(fresh.roomCode));
        fresh.selectionEndsAt = undefined;
      } else {
        fresh.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
      }
      await fresh.save();

      io.to(roomCode).emit("next_game_ready", { roomCode });
      io.to(roomCode).emit("room_state", buildRoomState(fresh));
    }, WINNER_DISPLAY_MS);
  }
}

module.exports = { initGameSocket, getActiveUserCount };