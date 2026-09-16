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

function randomUncalledNumber(calledNumbers, maxNumber) {
  const calledSet = new Set(calledNumbers);
  const pool = [];
  for (let i = 1; i <= maxNumber; i++) if (!calledSet.has(i)) pool.push(i);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function stopCaller(roomCode) {
  const handle = activeCallers.get(roomCode);
  if (handle) {
    clearInterval(handle);
    activeCallers.delete(roomCode);
  }
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
    reservedCards: (game.reservedCards || []).map((r) => ({
      cardId: r.cardId,
      telegramId: r.telegramId,
    })),
    winnersCount: game.winners?.length || 0,
    nextGameAt: game.nextGameAt,
  };
}

function initGameSocket(io) {
  const MIN_PLAYERS = Number(process.env.MIN_PLAYERS || 1);
  const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 1000);
  const CALL_INTERVAL_MS = Number(process.env.CALL_INTERVAL_MS || 4000);
  const NEXT_GAME_DELAY_MS = Number(process.env.NEXT_GAME_DELAY_MS || 15000);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const payload = token ? verifySocketToken(token) : null;
    if (!payload) return next(new Error("unauthorized"));
    socket.userId = payload.userId;
    socket.telegramId = payload.telegramId;
    next();
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected: user ${socket.telegramId}`);
    activeUserIds.add(socket.userId);

    // ═══════════════════════════════════════════════════════
    // ካርድ መምረጥ (Select Card - Reserve)
    // ═══════════════════════════════════════════════════════
    socket.on("select_card", async ({ roomCode, cardId }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game) return socket.emit("error_message", { message: "Room not found." });
        if (game.status !== "waiting") {
          return socket.emit("error_message", { message: "Game already started." });
        }

        // ተጠቃሚውን መፈለግ
        const user = await User.findById(socket.userId);
        if (!user) return socket.emit("error_message", { message: "User not found." });

        // ካርዱ አስቀድሞ በሌላ ሰው መያዙን ማረጋገጥ
        const reservedByOther = (game.reservedCards || []).some(
          (r) => r.cardId === cardId && r.telegramId !== socket.telegramId
        );
        const takenByPlayer = game.players.some((p) => p.cardId === cardId);

        if (reservedByOther || takenByPlayer) {
          return socket.emit("error_message", { message: `❌ ካርድ #${cardId} አስቀድሞ ተይዟል!` });
        }

        // አስቀድሞ በራሱ ከተያዘ ምንም አያድርግ
        const alreadyReservedByMe = (game.reservedCards || []).some(
          (r) => r.cardId === cardId && r.telegramId === socket.telegramId
        );
        if (alreadyReservedByMe) {
          return socket.emit("error_message", { message: "Already reserved by you." });
        }

        // ባላንስ ማረጋገጥ
        if (user.balance < game.entryFee) {
          return socket.emit("error_message", { message: "Insufficient balance to reserve this card." });
        }

        // ብር ቀንስ
        user.balance -= game.entryFee;
        await user.save();
        await Transaction.create({
          user: user._id,
          type: "entry_fee",
          amount: game.entryFee,
          balanceAfter: user.balance,
          game: game._id,
          meta: { action: "card_reservation", cardId },
        });

        // ወደ reservedCards ጨምር
        if (!game.reservedCards) game.reservedCards = [];
        game.reservedCards.push({
          user: user._id,
          telegramId: socket.telegramId,
          cardId,
        });
        await game.save();

        // ለሁሉም ተጫዋቾች አሳውቅ
        io.to(roomCode).emit("card_selected", {
          cardId,
          telegramId: socket.telegramId,
          telegramId_str: String(socket.telegramId),
        });
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        console.error("[select_card] error:", err);
        socket.emit("error_message", { message: "Failed to select card." });
      }
    });

    // ═══════════════════════════════════════════════════════
    // ካርድ መሰረዝ (Deselect Card - Refund)
    // ═══════════════════════════════════════════════════════
    socket.on("deselect_card", async ({ roomCode, cardId }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game) return;
        if (game.status !== "waiting") return;

        const user = await User.findById(socket.userId);
        if (!user) return;

        // የራሱ ምርጫ መሆኑን ማረጋገጥ
        const reservationIndex = (game.reservedCards || []).findIndex(
          (r) => r.cardId === cardId && r.telegramId === socket.telegramId
        );
        if (reservationIndex === -1) {
          return socket.emit("error_message", { message: "This card is not reserved by you." });
        }

        // ብር መመለስ
        user.balance += game.entryFee;
        await user.save();
        await Transaction.create({
          user: user._id,
          type: "refund",
          amount: game.entryFee,
          balanceAfter: user.balance,
          game: game._id,
          meta: { action: "card_deselection", cardId },
        });

        // ከ reservedCards አስወግድ
        game.reservedCards.splice(reservationIndex, 1);
        await game.save();

        // ለሁሉም አሳውቅ
        io.to(roomCode).emit("card_deselected", { cardId });
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        console.error("[deselect_card] error:", err);
      }
    });

    // ═══════════════════════════════════════════════════════
    // JOIN ROOM
    // ═══════════════════════════════════════════════════════
    socket.on("join_room", async ({ roomCode, cardId, watchOnly }) => {
      try {
        if (!roomCode) return socket.emit("error_message", { message: "roomCode is required." });
        roomCode = String(roomCode).trim().toUpperCase();

        const guardKey = `${socket.id}:${roomCode}`;
        if (joinGuards.has(guardKey)) return;
        joinGuards.set(guardKey, true);
        setTimeout(() => joinGuards.delete(guardKey), 3000);

        let game = await Game.findOne({ roomCode });
        if (!game) {
          game = await Game.create({
            roomCode,
            entryFee: Number(process.env.ENTRY_FEE || 10),
            maxNumber: Number(process.env.BINGO_MAX_NUMBER || 75),
            allCards: generate1000Cards(),
            winners: [],
            reservedCards: [],
          });
        } else if (!game.allCards || game.allCards.length === 0) {
          game.allCards = generate1000Cards();
          await game.save();
        }

        const user = await User.findById(socket.userId);
        if (!user) return socket.emit("error_message", { message: "User not found." });

        let player = game.players.find((p) => p.user.toString() === socket.userId);

        // ጨዋታ ከጀመረ በኋላ - ለመመልከት ብቻ
        if ((game.status === "active" || game.status === "finished") && !player) {
          socket.join(roomCode);
          socket.data.roomCode = roomCode;
          socket.data.watching = true;
          socket.emit("watching_mode", { roomCode });
          io.to(roomCode).emit("room_state", buildRoomState(game));
          return;
        }

        if (!player) {
          if (watchOnly) {
            socket.join(roomCode);
            socket.data.roomCode = roomCode;
            socket.data.watching = true;
            socket.emit("watching_mode", { roomCode });
            io.to(roomCode).emit("room_state", buildRoomState(game));
            return;
          }

          if (game.players.length >= MAX_PLAYERS) {
            return socket.emit("error_message", {
              message: `❌ ክፍሉ ሙሉ ነው! ከፍተኛው ${MAX_PLAYERS} ተጫዋች ብቻ ነው።`,
            });
          }

          let selectedId = parseInt(cardId, 10);
          if (!selectedId || selectedId < 1 || selectedId > 1000) selectedId = 1;

          // ካርዱ ከ reservedCards የተመረጠ ከሆነ ብሩ አስቀድሞ ተከፍሏል
          const reservedByUser = (game.reservedCards || []).find(
            (r) => r.cardId === selectedId && r.telegramId === socket.telegramId
          );

          const takenSet = new Set(game.players.map((p) => p.cardId));
          if (takenSet.has(selectedId)) {
            for (let i = 1; i <= 1000; i++) {
              if (!takenSet.has(i)) { selectedId = i; break; }
            }
          }

          // ብር የሚቀነሰው ካልተቀዳ (unreserved) ከሆነ ብቻ
          if (!reservedByUser) {
            if (user.balance < game.entryFee) {
              return socket.emit("error_message", { message: "Insufficient balance to join this game." });
            }
            user.balance -= game.entryFee;
            await user.save();
            await Transaction.create({
              user: user._id,
              type: "entry_fee",
              amount: game.entryFee,
              balanceAfter: user.balance,
              game: game._id,
            });
          }

          const cardData = game.allCards.find((c) => c.cardId === selectedId) || game.allCards[0];
          game.players.push({
            user: user._id,
            cardId: cardData.cardId,
            card: cardData.card,
            marked: cardData.marked.map((r) => [...r]),
            hasWon: false,
            isWatching: false,
          });
          game.prizePool += game.entryFee;

          // ካርዱን ከ reservedCards አስወግድ
          if (reservedByUser) {
            game.reservedCards = game.reservedCards.filter(
              (r) => !(r.cardId === selectedId && r.telegramId === socket.telegramId)
            );
          }

          await game.save();
          player = game.players[game.players.length - 1];

          socket.emit("balance_update", { balance: user.balance });
        }

        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.watching = false;

        socket.emit("your_card", {
          cardId: player.cardId,
          card: player.card,
          marked: player.marked,
        });

        io.to(roomCode).emit("room_state", buildRoomState(game));

        if (game.status === "waiting" && game.players.length >= MIN_PLAYERS) {
          startGame(io, roomCode, CALL_INTERVAL_MS, NEXT_GAME_DELAY_MS);
        }
      } catch (err) {
        console.error("[join_room] error:", err);
        socket.emit("error_message", { message: "Failed to join room." });
      }
    });

    // ---- MARK CELL ----
    socket.on("mark_cell", async ({ roomCode, row, col }) => {
      try {
        if (typeof row !== "number" || typeof col !== "number" || row < 0 || row > 4 || col < 0 || col > 4) return;
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "active") return;
        const player = game.players.find((p) => p.user.toString() === socket.userId);
        if (!player) return;
        const number = player.card[row][col];
        if (number !== 0 && !game.calledNumbers.includes(number)) {
          return socket.emit("error_message", { message: "That number hasn't been called yet." });
        }
        player.marked[row][col] = true;
        game.markModified("players");
        await game.save();
        socket.emit("your_card", { cardId: player.cardId, card: player.card, marked: player.marked });
      } catch (err) {
        console.error("[mark_cell] error:", err);
      }
    });

    // ---- CLAIM BINGO ----
    socket.on("claim_bingo", async ({ roomCode }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "active") {
          return socket.emit("error_message", { message: "No active game here." });
        }

        const player = game.players.find((p) => p.user.toString() === socket.userId);
        if (!player || player.hasWon) return;

        const pattern = checkWin(player.marked);
        if (!pattern) {
          return socket.emit("bingo_rejected", { message: "Not a valid bingo yet - keep playing!" });
        }

        player.hasWon = true;
        game.markModified("players");

        if (!game.winners) game.winners = [];
        if (!game.winners.some((w) => w.toString() === player.user.toString())) {
          game.winners.push(player.user);
        }

        const winnerUser = await User.findById(player.user);
        if (winnerUser) {
          const share = Math.floor(game.prizePool / game.winners.length);
          winnerUser.balance += share;
          winnerUser.gamesWon += 1;
          winnerUser.totalWinnings = (winnerUser.totalWinnings || 0) + share;
          await winnerUser.save();
          await Transaction.create({
            user: winnerUser._id,
            type: "prize",
            amount: share,
            balanceAfter: winnerUser.balance,
            game: game._id,
          });
          socket.emit("balance_update", { balance: winnerUser.balance });
        }

        await game.save();

        const winnerUsers = await User.find({ _id: { $in: game.winners } }).select("telegramId username firstName");
        io.to(roomCode).emit("bingo_claimed", {
          winners: winnerUsers.map((w) => ({
            telegramId: w.telegramId,
            name: w.username || w.firstName,
          })),
          pattern,
          prizePool: game.prizePool,
        });

        setTimeout(async () => {
          const current = await Game.findOne({ roomCode });
          if (!current || current.status !== "active") return;
          await finishGame(io, roomCode, current, NEXT_GAME_DELAY_MS);
        }, 2000);
      } catch (err) {
        console.error("[claim_bingo] error:", err);
        socket.emit("error_message", { message: "Failed to validate bingo." });
      }
    });

    socket.on("leave_room", () => {
      if (socket.data.roomCode) socket.leave(socket.data.roomCode);
    });

    socket.on("disconnect", () => {
      const stillConnected = [...io.sockets.sockets.values()].some((s) => s.userId === socket.userId);
      if (!stillConnected) activeUserIds.delete(socket.userId);
    });
  });

  async function finishGame(io, roomCode, game, nextDelayMs) {
    stopCaller(roomCode);
    game.status = "finished";
    game.finishedAt = new Date();
    game.nextGameAt = new Date(Date.now() + nextDelayMs);
    await game.save();

    for (const p of game.players) {
      await User.findByIdAndUpdate(p.user, { $inc: { gamesPlayed: 1 } });
    }

    const winners = await User.find({ _id: { $in: game.winners } }).select("telegramId username firstName");

    io.to(roomCode).emit("game_over", {
      winners: winners.map((w) => ({
        telegramId: w.telegramId,
        name: w.username || w.firstName,
      })),
      prizePool: game.prizePool,
      nextGameAt: game.nextGameAt,
      pattern: game.winPattern,
    });

    setTimeout(async () => {
      const fresh = await Game.findOne({ roomCode });
      if (!fresh) return;
      fresh.status = "waiting";
      fresh.calledNumbers = [];
      fresh.prizePool = 0;
      fresh.winners = [];
      fresh.winPattern = undefined;
      fresh.startedAt = undefined;
      fresh.finishedAt = undefined;
      fresh.nextGameAt = undefined;
      fresh.players = [];
      fresh.reservedCards = [];
      await fresh.save();
      io.to(roomCode).emit("next_game_ready", { roomCode });
      io.to(roomCode).emit("room_state", buildRoomState(fresh));
    }, nextDelayMs);
  }

  async function startGame(io, roomCode, intervalMs, nextDelayMs) {
    const game = await Game.findOne({ roomCode });
    if (!game || game.status !== "waiting") return;

    game.status = "active";
    game.startedAt = new Date();
    game.calledNumbers = [];
    game.winners = [];
    game.winPattern = undefined;
    await game.save();

    io.to(roomCode).emit("game_started", { roomCode });

    const handle = setInterval(async () => {
      try {
        const current = await Game.findOne({ roomCode });
        if (!current || current.status !== "active") {
          stopCaller(roomCode);
          return;
        }
        const number = randomUncalledNumber(current.calledNumbers, current.maxNumber);
        if (number === null) {
          stopCaller(roomCode);
          await finishGame(io, roomCode, current, nextDelayMs);
          return;
        }
        current.calledNumbers.push(number);

        for (const player of current.players) {
          markNumber(player.card, player.marked, number);
        }

        current.markModified("players");
        current.markModified("calledNumbers");
        await current.save();

        for (const player of current.players) {
          const pUser = [...io.sockets.sockets.values()].find(
            (s) => s.userId === player.user.toString()
          );
          if (pUser) {
            pUser.emit("your_card", {
              cardId: player.cardId,
              card: player.card,
              marked: player.marked,
            });
          }
        }

        io.to(roomCode).emit("number_called", {
          number,
          calledNumbers: current.calledNumbers,
        });
      } catch (err) {
        console.error(`[caller:${roomCode}] error:`, err);
      }
    }, intervalMs);

    activeCallers.set(roomCode, handle);
  }
}

module.exports = { initGameSocket, getActiveUserCount };