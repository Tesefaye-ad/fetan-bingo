const Game = require("../models/Game");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { generate1000Cards, checkWin, markNumber } = require("../utils/bingoCard");
const { verifySocketToken } = require("../middleware/auth");

// Tracks setInterval handles for each active room's auto-caller so we can
// stop them when the game ends. Keyed by roomCode.
const activeCallers = new Map();

function randomUncalledNumber(calledNumbers, maxNumber) {
  const pool = [];
  for (let i = 1; i <= maxNumber; i++) {
    if (!calledNumbers.includes(i)) pool.push(i);
  }
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

function initGameSocket(io) {
  // Auth middleware for every socket connection: client passes the JWT
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

    // ---- JOIN ROOM & SELECT CARD ID --------------------------------------
    socket.on("join_room", async ({ roomCode, cardId }) => {
      try {
        if (!roomCode) {
          return socket.emit("error_message", { message: "roomCode is required." });
        }
        roomCode = String(roomCode).trim().toUpperCase();

        let game = await Game.findOne({ roomCode });
        if (!game) {
          // ክፍሉ ሲፈጠር ለዚህ ክፍል 1000ቱን ካርዶች በቅድመ-ዝግጅት እናመነጫለን
          game = await Game.create({
            roomCode,
            entryFee: Number(process.env.ENTRY_FEE || 10),
            maxNumber: Number(process.env.BINGO_MAX_NUMBER || 75),
            allCards: generate1000Cards(),
          });
        } else if (!game.allCards || game.allCards.length === 0) {
          game.allCards = generate1000Cards();
          await game.save();
        }

        if (game.status === "active" || game.status === "finished") {
          const alreadyIn = game.players.find(
            (p) => p.user.toString() === socket.userId
          );
          if (!alreadyIn) {
            return socket.emit("error_message", {
              message: "Game already in progress. Wait for the next round.",
            });
          }
        }

        const user = await User.findById(socket.userId);
        if (!user) {
          return socket.emit("error_message", { message: "User not found." });
        }

        let player = game.players.find(
          (p) => p.user.toString() === socket.userId
        );

        if (!player) {
          let selectedId = parseInt(cardId, 10);
          if (!selectedId || selectedId < 1 || selectedId > 1000) {
            selectedId = 1;
          }

          // ካርዱ አስቀድሞ በሌላ ተጫዋች መያዙን ማረጋገጥ
          const isTakenByOther = game.players.find((p) => p.cardId === selectedId);
          if (isTakenByOther) {
            return socket.emit("error_message", {
              message: `❌ ካርድ #${selectedId} አስቀድሞ በሌላ ተጫዋች ተይዟል! እባክዎ ሌላ ይምረጡ።`,
            });
          }

          if (user.balance < game.entryFee) {
            return socket.emit("error_message", {
              message: "Insufficient balance to join this game.",
            });
          }

          // Deduct entry fee and record the ledger entry
          user.balance -= game.entryFee;
          await user.save();
          await Transaction.create({
            user: user._id,
            type: "entry_fee",
            amount: game.entryFee,
            balanceAfter: user.balance,
            game: game._id,
          });

          // ከ 1000 ካርዶች ውስጥ የተመረጠውን ካርድ መውሰድ
          const cardData = game.allCards.find((c) => c.cardId === selectedId) || game.allCards[0];

          game.players.push({
            user: user._id,
            cardId: cardData.cardId,
            card: cardData.card,
            marked: cardData.marked.map((r) => [...r]),
            hasWon: false,
          });
          game.prizePool += game.entryFee;
          await game.save();
          player = game.players[game.players.length - 1];

          socket.emit("balance_update", { balance: user.balance });
        }

        socket.join(roomCode);
        socket.data.roomCode = roomCode;

        socket.emit("your_card", { cardId: player.cardId, card: player.card, marked: player.marked });

        // የተያዙ ካርዶችን (Taken Cards) ዝርዝር ለሁሉም ተጫዋቾች ማሳወቅ
        const takenCardsList = game.players.map((p) => p.cardId);

        io.to(roomCode).emit("room_state", {
          roomCode,
          status: game.status,
          playerCount: game.players.length,
          prizePool: game.prizePool,
          calledNumbers: game.calledNumbers,
          takenCards: takenCardsList,
        });

        // Auto-start once at least 2 players have joined a waiting room.
        if (game.status === "waiting" && game.players.length >= 2) {
          startGame(io, roomCode);
        }
      } catch (err) {
        console.error("[join_room] error:", err);
        socket.emit("error_message", { message: "Failed to join room." });
      }
    });

    // ---- MARK A CELL ----------------------------------------------------
    socket.on("mark_cell", async ({ roomCode, row, col }) => {
      try {
        if (
          typeof row !== "number" ||
          typeof col !== "number" ||
          row < 0 ||
          row > 4 ||
          col < 0 ||
          col > 4
        ) {
          return;
        }

        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "active") return;

        const player = game.players.find(
          (p) => p.user.toString() === socket.userId
        );
        if (!player) return;

        const number = player.card[row][col];
        if (number !== 0 && !game.calledNumbers.includes(number)) {
          return socket.emit("error_message", {
            message: "That number hasn't been called yet.",
          });
        }

        player.marked[row][col] = true;
        game.markModified("players");
        await game.save();
        socket.emit("your_card", { cardId: player.cardId, card: player.card, marked: player.marked });
      } catch (err) {
        console.error("[mark_cell] error:", err);
      }
    });

    // ---- CLAIM BINGO ----------------------------------------------------
    socket.on("claim_bingo", async ({ roomCode }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "active") {
          return socket.emit("error_message", { message: "No active game here." });
        }

        const player = game.players.find(
          (p) => p.user.toString() === socket.userId
        );
        if (!player || player.hasWon) return;

        const pattern = checkWin(player.marked);
        if (!pattern) {
          return socket.emit("bingo_rejected", {
            message: "Not a valid bingo yet - keep playing!",
          });
        }

        stopCaller(roomCode);
        game.status = "finished";
        game.winner = player.user;
        game.winPattern = pattern;
        game.finishedAt = new Date();
        player.hasWon = true;
        game.markModified("players");
        await game.save();

        const winnerUser = await User.findById(player.user);
        winnerUser.balance += game.prizePool;
        winnerUser.gamesWon += 1;
        await winnerUser.save();

        await Transaction.create({
          user: winnerUser._id,
          type: "prize",
          amount: game.prizePool,
          balanceAfter: winnerUser.balance,
          game: game._id,
        });

        for (const p of game.players) {
          await User.findByIdAndUpdate(p.user, { $inc: { gamesPlayed: 1 } });
        }

        io.to(roomCode).emit("game_over", {
          winnerTelegramId: winnerUser.telegramId,
          winnerName: winnerUser.username || winnerUser.firstName,
          pattern,
          prizePool: game.prizePool,
        });

        io.to(roomCode).emit("balance_update_for", {
          telegramId: winnerUser.telegramId,
          balance: winnerUser.balance,
        });
      } catch (err) {
        console.error("[claim_bingo] error:", err);
        socket.emit("error_message", { message: "Failed to validate bingo." });
      }
    });

    socket.on("leave_room", () => {
      if (socket.data.roomCode) socket.leave(socket.data.roomCode);
    });

    socket.on("disconnect", () => {
      console.log(`[socket] disconnected: user ${socket.telegramId}`);
    });
  });
}

async function startGame(io, roomCode) {
  const game = await Game.findOne({ roomCode });
  if (!game || game.status !== "waiting") return;

  game.status = "active";
  game.startedAt = new Date();
  await game.save();

  io.to(roomCode).emit("game_started", { roomCode });

  const intervalMs = Number(process.env.CALL_INTERVAL_MS || 4000);

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
        current.status = "finished";
        current.finishedAt = new Date();
        await current.save();
        io.to(roomCode).emit("game_over", { draw: true });
        return;
      }

      current.calledNumbers.push(number);

      for (const player of current.players) {
        markNumber(player.card, player.marked, number);
      }
      current.markModified("players");
      await current.save();

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

module.exports = { initGameSocket };