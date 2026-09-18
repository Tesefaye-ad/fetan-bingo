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
    clearTimeout(handle);
    activeCallers.delete(roomCode);
    console.log(`[caller:${roomCode}] Stopped`);
  }
}

// ═══════════════════════════════════════════════════════
// 👈 ሳምንታዊ ጨዋታ — ቀጣዩን ቅዳሜ ማታ ሰዓት አስላ
// ═══════════════════════════════════════════════════════
function getNextWeeklyStart(fee) {
  const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3
  const now = new Date();
  const ethiopiaNow = new Date(now.getTime() + ETHIOPIA_OFFSET_MS);

  const targetDay = 6; // ቅዳሜ
  const targetHour = 0; // 12:00 AM Ethiopian
  const targetMinute = fee === 50 ? 0 : 5;

  let daysUntil = (targetDay - ethiopiaNow.getUTCDay() + 7) % 7;
  if (daysUntil === 0) {
    const todayTarget = new Date(ethiopiaNow);
    todayTarget.setUTCHours(targetHour, targetMinute, 0, 0);
    if (ethiopiaNow >= todayTarget) daysUntil = 7;
  }

  const nextStart = new Date(ethiopiaNow);
  nextStart.setUTCDate(nextStart.getUTCDate() + daysUntil);
  nextStart.setUTCHours(targetHour, targetMinute, 0, 0);

  return new Date(nextStart.getTime() - ETHIOPIA_OFFSET_MS);
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
    reservedCards: (game.reservedCards || []).map((r) => ({
      cardId: r.cardId,
      telegramId: r.telegramId,
    })),
    winnersCount: game.winners?.length || 0,
    nextGameAt: game.nextGameAt,
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

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const payload = token ? verifySocketToken(token) : null;
    if (!payload) return next(new Error("unauthorized"));
    socket.userId = payload.userId;
    socket.telegramId = payload.telegramId;
    next();
  });

  // ═══════════════════════════════════════════════════════
  // 👈 AUTO-STARTER + STALE CLEANER (በየ 3 ሰከንዱ)
  // ═══════════════════════════════════════════════════════
  setInterval(async () => {
    try {
      // ─── 1. የመደበኛ ጨዋታዎች (ROOM10, ROOM20) — ሰዓቱ ካለፈ ጀምር ───
      const regularRooms = await Game.find({
        status: "waiting",
        isWeeklyGame: false,
      });
      for (const game of regularRooms) {
        if (
          game.selectionEndsAt &&
          new Date(game.selectionEndsAt) < new Date()
        ) {
          console.log(`[auto-starter] Starting regular ${game.roomCode}`);
          startGame(io, game.roomCode, CALL_INTERVAL_MS, NEXT_GAME_DELAY_MS, SELECTION_TIMER_MS);
        }
      }

      // ─── 2. ሳምንታዊ ጨዋታዎች (ROOM50, ROOM100) — በተዘጋጀው ሰዓት ብቻ ───
      const weeklyRooms = await Game.find({
        status: "waiting",
        isWeeklyGame: true,
      });
      for (const game of weeklyRooms) {
        if (game.scheduledStart && new Date(game.scheduledStart) <= new Date()) {
          console.log(`[auto-starter] Starting WEEKLY ${game.roomCode}`);
          startGame(io, game.roomCode, CALL_INTERVAL_MS, NEXT_GAME_DELAY_MS, SELECTION_TIMER_MS);
        }
      }

      // ─── 3. የቆዩ "active" ጨዋታዎችን አጽዳ (ከ 3 ደቂቃ በላይ) ───
      const activeRooms = await Game.find({ status: "active" });
      for (const game of activeRooms) {
        if (game.startedAt) {
          const minutes = (Date.now() - new Date(game.startedAt).getTime()) / 60000;
          if (minutes > 3) {
            console.log(`[auto-starter] Resetting stale active: ${game.roomCode} (${minutes.toFixed(1)} min)`);
            game.status = "waiting";
            game.calledNumbers = [];
            game.prizePool = 0;
            game.winners = [];
            game.winningCartelas = [];
            game.winPattern = undefined;
            game.startedAt = undefined;
            game.finishedAt = undefined;
            game.nextGameAt = undefined;
            game.players = [];
            game.reservedCards = [];

            // 👈 ሳምንታዊ ከሆነ — ቀጣዩ ቅዳሜ
            if (game.isWeeklyGame) {
              game.scheduledStart = getNextWeeklyStart(getWeeklyFee(game.roomCode));
            } else {
              game.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
            }
            await game.save();
          }
        }
      }

      // ─── 4. የቆዩ "finished" ጨዋታዎችን አጽዳ (ከ 5 ደቂቃ በላይ) ───
      const finishedRooms = await Game.find({ status: "finished" });
      for (const game of finishedRooms) {
        if (game.finishedAt) {
          const minutes = (Date.now() - new Date(game.finishedAt).getTime()) / 60000;
          if (minutes > 5) {
            console.log(`[auto-starter] Resetting stale finished: ${game.roomCode}`);
            game.status = "waiting";
            game.calledNumbers = [];
            game.prizePool = 0;
            game.winners = [];
            game.winningCartelas = [];
            game.winPattern = undefined;
            game.startedAt = undefined;
            game.finishedAt = undefined;
            game.nextGameAt = undefined;
            game.players = [];
            game.reservedCards = [];

            if (game.isWeeklyGame) {
              game.scheduledStart = getNextWeeklyStart(getWeeklyFee(game.roomCode));
            } else {
              game.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
            }
            await game.save();
          }
        }
      }
    } catch (err) {
      console.error("[auto-starter] error:", err.message);
    }
  }, 3000);

  io.on("connection", (socket) => {
    console.log(`[socket] connected: user ${socket.telegramId}`);
    activeUserIds.add(socket.userId);

    // ═══════════════════════════════════════════════════════
    // ካርድ መምረጥ (Reserve)
    // ═══════════════════════════════════════════════════════
    socket.on("select_card", async ({ roomCode, cardId }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game) return socket.emit("error_message", { message: "Room not found." });
        if (game.status !== "waiting") {
          return socket.emit("error_message", { message: "Game already started." });
        }

        const user = await User.findById(socket.userId);
        if (!user) return socket.emit("error_message", { message: "User not found." });

        const reservedByOther = (game.reservedCards || []).some(
          (r) => r.cardId === cardId && String(r.telegramId) !== String(socket.telegramId)
        );
        const takenByPlayer = game.players.some((p) => p.cardId === cardId);

        if (reservedByOther || takenByPlayer) {
          return socket.emit("error_message", {
            message: `❌ ካርድ #${cardId} አስቀድሞ ተይዟል!`,
          });
        }

        const alreadyReservedByMe = (game.reservedCards || []).some(
          (r) => r.cardId === cardId && String(r.telegramId) === String(socket.telegramId)
        );
        if (alreadyReservedByMe) {
          return socket.emit("error_message", { message: "Already reserved by you." });
        }

        if (user.balance < game.entryFee) {
          return socket.emit("error_message", {
            message: "Insufficient balance to reserve this card.",
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
          meta: { action: "card_reservation", cardId },
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
        console.error("[select_card] error:", err);
        socket.emit("error_message", { message: "Failed to select card." });
      }
    });

    // ═══════════════════════════════════════════════════════
    // ካርድ መሰረዝ (Refund)
    // ═══════════════════════════════════════════════════════
    socket.on("deselect_card", async ({ roomCode, cardId }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game) return;
        if (game.status !== "waiting") return;

        const user = await User.findById(socket.userId);
        if (!user) return;

        const reservationIndex = (game.reservedCards || []).findIndex(
          (r) => r.cardId === cardId && String(r.telegramId) === String(socket.telegramId)
        );
        if (reservationIndex === -1) {
          return socket.emit("error_message", {
            message: "This card is not reserved by you.",
          });
        }

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

        game.reservedCards.splice(reservationIndex, 1);
        await game.save();

        io.to(roomCode).emit("card_deselected", {
          cardId,
          telegramId: socket.telegramId,
        });
        socket.emit("balance_update", { balance: user.balance });
      } catch (err) {
        console.error("[deselect_card] error:", err);
      }
    });

    // ═══════════════════════════════════════════════════════
    // JOIN ROOM
    // ═══════════════════════════════════════════════════════
    socket.on("join_room", async ({ roomCode, cardId, cardIds, watchOnly }) => {
      try {
        if (!roomCode)
          return socket.emit("error_message", { message: "roomCode is required." });
        roomCode = String(roomCode).trim().toUpperCase();

        const cardsToJoin = Array.isArray(cardIds) && cardIds.length > 0
          ? cardIds
          : (cardId ? [cardId] : []);

        const guardKey = `${socket.id}:${roomCode}`;
        if (joinGuards.has(guardKey)) return;
        joinGuards.set(guardKey, true);
        setTimeout(() => joinGuards.delete(guardKey), 3000);

        let game = await Game.findOne({ roomCode });

        // ═══════════════════════════════════════════════
        // 1️⃣ የቆየ "active" ጨዋታ ካለ አጽዳ (ከ 3 ደቂቃ በላይ)
        // ═══════════════════════════════════════════════
        if (game && game.status === "active" && game.startedAt) {
          const activeMinutes =
            (Date.now() - new Date(game.startedAt).getTime()) / 60000;
          if (activeMinutes > 3) {
            console.log(
              `[join_room] Stale active game (${activeMinutes.toFixed(1)} min), resetting ${roomCode}`
            );
            game.status = "waiting";
            game.calledNumbers = [];
            game.prizePool = 0;
            game.winners = [];
            game.winningCartelas = [];
            game.winPattern = undefined;
            game.startedAt = undefined;
            game.finishedAt = undefined;
            game.nextGameAt = undefined;
            game.players = [];
            game.reservedCards = [];

            if (game.isWeeklyGame) {
              game.scheduledStart = getNextWeeklyStart(getWeeklyFee(game.roomCode));
            } else {
              game.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
            }
            await game.save();
          }
        }

        // ═══════════════════════════════════════════════
        // 2️⃣ ክፍሉ ከሌለ አዲስ ፍጠር
        // ═══════════════════════════════════════════════
        if (!game) {
          const weekly = isWeeklyRoom(roomCode);
          const weeklyFee = weekly ? getWeeklyFee(roomCode) : 10;

          const newGameData = {
            roomCode,
            entryFee: Number(process.env.ENTRY_FEE || weeklyFee),
            maxNumber: Number(process.env.BINGO_MAX_NUMBER || 75),
            allCards: generate1000Cards(),
            winners: [],
            reservedCards: [],
            isWeeklyGame: weekly,
          };

          if (weekly) {
            newGameData.scheduledStart = getNextWeeklyStart(weeklyFee);
            console.log(
              `[join_room] Created weekly room ${roomCode}, scheduled at ${newGameData.scheduledStart.toISOString()}`
            );
          } else {
            newGameData.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
            console.log(`[join_room] Created regular room ${roomCode}`);
          }

          game = await Game.create(newGameData);
        } else if (!game.allCards || game.allCards.length === 0) {
          game.allCards = generate1000Cards();
          await game.save();
        }

        // ═══════════════════════════════════════════════
        // 3️⃣ መደበኛ ጨዋታ ከሆነ ብቻ — ሰዓቱ ካለፈ አድስ
        // ═══════════════════════════════════════════════
        if (
          !game.isWeeklyGame &&
          game.status === "waiting" &&
          (!game.selectionEndsAt || new Date(game.selectionEndsAt) < new Date())
        ) {
          game.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
          await game.save();
          console.log(`[join_room] Timer reset for ${roomCode}`);
        }

        const user = await User.findById(socket.userId);
        if (!user) return socket.emit("error_message", { message: "User not found." });

        const existingPlayers = game.players.filter(
          (p) => p.user.toString() === socket.userId
        );

        // ─── ጨዋታ ከጀመረ ወይም ካርድ ከሌለ - ተመልካች ───
        if (
          (game.status === "active" || game.status === "finished") &&
          existingPlayers.length === 0
        ) {
          socket.join(roomCode);
          socket.data.roomCode = roomCode;
          socket.data.watching = true;
          socket.emit("watching_mode", { roomCode });
          socket.emit("your_cards", { cards: [], markedCards: [], cardIds: [] });
          io.to(roomCode).emit("room_state", buildRoomState(game));
          return;
        }

        if (existingPlayers.length === 0 && (watchOnly || cardsToJoin.length === 0)) {
          socket.join(roomCode);
          socket.data.roomCode = roomCode;
          socket.data.watching = true;
          socket.emit("watching_mode", { roomCode });
          socket.emit("your_cards", { cards: [], markedCards: [], cardIds: [] });
          io.to(roomCode).emit("room_state", buildRoomState(game));
          return;
        }

        if (existingPlayers.length === 0) {
          if (game.players.length >= MAX_PLAYERS) {
            return socket.emit("error_message", {
              message: `❌ ክፍሉ ሙሉ ነው! ከፍተኛው ${MAX_PLAYERS} ተጫዋች ብቻ ነው።`,
            });
          }

          const takenSet = new Set(game.players.map((p) => p.cardId));
          const playerCards = [];
          const playerMarked = [];
          const playerCardIds = [];

          for (const cid of cardsToJoin) {
            const selectedId = parseInt(cid, 10);
            if (!selectedId || selectedId < 1 || selectedId > 1000) continue;
            if (takenSet.has(selectedId)) continue;

            const cardData = game.allCards.find((c) => c.cardId === selectedId);
            if (!cardData) continue;

            const reservedByUser = (game.reservedCards || []).find(
              (r) =>
                r.cardId === selectedId &&
                String(r.telegramId) === String(socket.telegramId)
            );

            if (!reservedByUser) {
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
                meta: { cardId: selectedId },
              });
            }

            game.players.push({
              user: user._id,
              cardId: cardData.cardId,
              card: cardData.card,
              marked: cardData.marked.map((r) => [...r]),
              hasWon: false,
              isWatching: false,
            });

            // 👈 Derash = 80%
            game.prizePool += Math.floor(game.entryFee * 0.8);
            takenSet.add(selectedId);

            playerCards.push(cardData.card);
            playerMarked.push(cardData.marked.map((r) => [...r]));
            playerCardIds.push(cardData.cardId);
          }

          game.reservedCards = (game.reservedCards || []).filter(
            (r) => String(r.telegramId) !== String(socket.telegramId)
          );

          if (playerCards.length === 0) {
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

          socket.emit("balance_update", { balance: user.balance });
          socket.emit("your_cards", {
            cards: playerCards,
            markedCards: playerMarked,
            cardIds: playerCardIds,
          });
        } else {
          const allCards = existingPlayers.map((p) => p.card);
          const allMarked = existingPlayers.map((p) => p.marked);
          const allIds = existingPlayers.map((p) => p.cardId);
          socket.emit("your_cards", {
            cards: allCards,
            markedCards: allMarked,
            cardIds: allIds,
          });
        }

        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.watching = false;

        io.to(roomCode).emit("room_state", buildRoomState(game));

        // ═══════════════════════════════════════════════
        // 👈 ወሳኝ: መደበኛ ጨዋታ ብቻ — ወዲያውኑ ጀምር
        // ሳምንታዊ — በተዘጋጀው ሰዓት ብቻ (auto-starter ይጀምረዋል)
        // ═══════════════════════════════════════════════
        if (
          !game.isWeeklyGame &&
          game.status === "waiting" &&
          game.players.length >= MIN_PLAYERS
        ) {
          startGame(
            io,
            roomCode,
            CALL_INTERVAL_MS,
            NEXT_GAME_DELAY_MS,
            SELECTION_TIMER_MS
          );
        }
      } catch (err) {
        console.error("[join_room] error:", err);
        socket.emit("error_message", { message: "Failed to join room." });
      }
    });

    // ═══════════════════════════════════════════════════════
    // MARK CELL
    // ═══════════════════════════════════════════════════════
    socket.on("mark_cell", async ({ roomCode, row, col }) => {
      try {
        if (
          typeof row !== "number" ||
          typeof col !== "number" ||
          row < 0 ||
          row > 4 ||
          col < 0 ||
          col > 4
        )
          return;
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "active") return;

        const userPlayers = game.players.filter(
          (p) => p.user.toString() === socket.userId
        );
        if (userPlayers.length === 0) return;

        let hasNumber = false;
        for (const player of userPlayers) {
          const number = player.card[row][col];
          if (number !== 0 && game.calledNumbers.includes(number)) {
            hasNumber = true;
            break;
          }
        }
        if (!hasNumber) {
          return socket.emit("error_message", {
            message: "That number hasn't been called yet.",
          });
        }

        for (const player of userPlayers) {
          const number = player.card[row][col];
          if (number === 0 || game.calledNumbers.includes(number)) {
            player.marked[row][col] = true;
          }
        }

        game.markModified("players");
        await game.save();

        const updatedCards = userPlayers.map((p) => p.card);
        const updatedMarked = userPlayers.map((p) => p.marked);
        const updatedIds = userPlayers.map((p) => p.cardId);
        socket.emit("your_cards", {
          cards: updatedCards,
          markedCards: updatedMarked,
          cardIds: updatedIds,
        });
      } catch (err) {
        console.error("[mark_cell] error:", err);
      }
    });

    // ═══════════════════════════════════════════════════════
    // CLAIM BINGO
    // ═══════════════════════════════════════════════════════
    socket.on("claim_bingo", async ({ roomCode }) => {
      try {
        const game = await Game.findOne({ roomCode });
        if (!game || game.status !== "active") {
          return socket.emit("error_message", { message: "No active game here." });
        }

        const userPlayers = game.players.filter(
          (p) => p.user.toString() === socket.userId
        );
        if (userPlayers.length === 0) return;

        const user = await User.findById(socket.userId);
        if (!user) return;

        const winningPlayers = [];
        for (const player of userPlayers) {
          if (player.hasWon) continue;
          const pattern = checkWin(player.marked);
          if (pattern) {
            player.hasWon = true;
            winningPlayers.push({ player, pattern });
          }
        }

        if (winningPlayers.length === 0) {
          return socket.emit("bingo_rejected", {
            message: "Not a valid bingo yet - keep playing!",
          });
        }

        game.markModified("players");

        if (!game.winningCartelas) game.winningCartelas = [];
        if (!game.winners) game.winners = [];

        for (const { player, pattern } of winningPlayers) {
          game.winningCartelas.push({
            userId: player.user,
            telegramId: socket.telegramId,
            cardId: player.cardId,
            name: user.username || user.firstName || "Player",
            pattern,
            card: player.card,
            marked: player.marked,
          });
        }

        if (!game.winners.some((w) => w.toString() === user._id.toString())) {
          game.winners.push(user._id);
        }

        const totalWinningCartelas = game.winningCartelas.length;
        const prizePerCartela = Math.floor(game.prizePool / totalWinningCartelas);
        const totalPrizeForUser = prizePerCartela * winningPlayers.length;

        user.balance += totalPrizeForUser;
        user.gamesWon += winningPlayers.length;
        user.totalWinnings = (user.totalWinnings || 0) + totalPrizeForUser;
        await user.save();

        await Transaction.create({
          user: user._id,
          type: "prize",
          amount: totalPrizeForUser,
          balanceAfter: user.balance,
          game: game._id,
          meta: { cartelaCount: winningPlayers.length },
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
          totalWinners: game.winningCartelas.length,
          prizePool: game.prizePool,
        });

        setTimeout(async () => {
          const current = await Game.findOne({ roomCode });
          if (!current || current.status !== "active") return;
          await finishGame(io, roomCode, current, NEXT_GAME_DELAY_MS, SELECTION_TIMER_MS);
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
      const stillConnected = [...io.sockets.sockets.values()].some(
        (s) => s.userId === socket.userId
      );
      if (!stillConnected) activeUserIds.delete(socket.userId);
    });
  });

  // ═══════════════════════════════════════════════════════
  // finishGame
  // ═══════════════════════════════════════════════════════
  async function finishGame(io, roomCode, game, nextDelayMs, selectionTimerMs) {
    stopCaller(roomCode);
    game.status = "finished";
    game.finishedAt = new Date();
    game.nextGameAt = new Date(Date.now() + nextDelayMs);
    game.selectionEndsAt = game.nextGameAt;
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
      totalWinners: (game.winningCartelas || []).length,
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
      fresh.winningCartelas = [];
      fresh.winPattern = undefined;
      fresh.startedAt = undefined;
      fresh.finishedAt = undefined;
      fresh.nextGameAt = undefined;
      fresh.players = [];
      fresh.reservedCards = [];

      if (fresh.isWeeklyGame) {
        // 👈 ሳምንታዊ — ቀጣዩ ቅዳሜ
        fresh.scheduledStart = getNextWeeklyStart(getWeeklyFee(fresh.roomCode));
      } else {
        fresh.selectionEndsAt = new Date(Date.now() + selectionTimerMs);
      }
      await fresh.save();
      io.to(roomCode).emit("next_game_ready", { roomCode });
      io.to(roomCode).emit("room_state", buildRoomState(fresh));
    }, nextDelayMs);
  }

  // ═══════════════════════════════════════════════════════
  // startGame — setTimeout recursion
  // ═══════════════════════════════════════════════════════
  async function startGame(io, roomCode, intervalMs, nextDelayMs, selectionTimerMs) {
    const game = await Game.findOne({ roomCode });
    if (!game || game.status !== "waiting") return;

    game.status = "active";
    game.startedAt = new Date();
    game.calledNumbers = [];
    game.winners = [];
    game.winningCartelas = [];
    game.winPattern = undefined;
    game.selectionEndsAt = undefined;
    await game.save();

    io.to(roomCode).emit("game_started", { roomCode });
    console.log(`[caller:${roomCode}] Game started, interval=${intervalMs}ms`);

    let callerActive = true;

    const runCaller = async () => {
      if (!callerActive) {
        activeCallers.delete(roomCode);
        return;
      }

      try {
        const current = await Game.findOne({ roomCode });
        if (!current || current.status !== "active") {
          callerActive = false;
          activeCallers.delete(roomCode);
          return;
        }

        const number = randomUncalledNumber(
          current.calledNumbers,
          current.maxNumber
        );
        if (number === null) {
          callerActive = false;
          activeCallers.delete(roomCode);
          await finishGame(io, roomCode, current, nextDelayMs, selectionTimerMs);
          return;
        }

        current.calledNumbers.push(number);
        console.log(
          `[caller:${roomCode}] Called ${number} (${current.calledNumbers.length}/${current.maxNumber})`
        );

        for (const player of current.players) {
          markNumber(player.card, player.marked, number);
        }

        current.markModified("players");
        current.markModified("calledNumbers");
        await current.save();

        if (current.players.length > 0) {
          const groupedByUser = {};
          for (const player of current.players) {
            const uid = player.user.toString();
            if (!groupedByUser[uid])
              groupedByUser[uid] = { cards: [], markedCards: [], cardIds: [] };
            groupedByUser[uid].cards.push(player.card);
            groupedByUser[uid].markedCards.push(player.marked);
            groupedByUser[uid].cardIds.push(player.cardId);
          }

          for (const sock of io.sockets.sockets.values()) {
            if (!sock.userId) continue;
            const group = groupedByUser[sock.userId];
            if (group && group.cards.length > 0) {
              sock.emit("your_cards", group);
            }
          }
        }

        io.to(roomCode).emit("number_called", {
          number,
          calledNumbers: current.calledNumbers,
        });
      } catch (err) {
        console.error(`[caller:${roomCode}] error:`, err);
      }

      if (callerActive) {
        const handle = setTimeout(runCaller, intervalMs);
        activeCallers.set(roomCode, handle);
      }
    };

    const initialHandle = setTimeout(runCaller, intervalMs);
    activeCallers.set(roomCode, initialHandle);
  }
}

module.exports = { initGameSocket, getActiveUserCount };