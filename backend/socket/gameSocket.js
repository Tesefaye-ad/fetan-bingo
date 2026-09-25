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

// ═══════════════════════════════════════════════════════
// 👈 DAILY — በየቀኑ 12:00 / 12:05 EAT
// ═══════════════════════════════════════════════════════
function getNextDailyStart(fee) {
  const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const et = new Date(now.getTime() + ETHIOPIA_OFFSET_MS);

  const targetHour = 12;
  const targetMinute = fee === 50 ? 0 : 5;

  const today = new Date(et);
  today.setUTCHours(targetHour, targetMinute, 0, 0);

  let next;
  if (et.getTime() < today.getTime()) {
    next = today;
  } else {
    next = new Date(today);
    next.setUTCDate(next.getUTCDate() + 1);
  }

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

// ═══════════════════════════════════════════════════════
// 🎴 Render Bingo Cartela as text art
// ═══════════════════════════════════════════════════════
function renderCartela(card, marked, pattern) {
  if (!card || !Array.isArray(card) || card.length !== 5) return "";
  const W = 8;

  const padCenter = (text, width) => {
    text = String(text);
    if (text.length >= width) return text.slice(0, width);
    const total = width - text.length;
    const left = Math.floor(total / 2);
    const right = total - left;
    return " ".repeat(left) + text + " ".repeat(right);
  };

  // Determine winning cells
  const winningSet = new Set();
  const k = (r, c) => `${r}-${c}`;

  if (pattern) {
    if (pattern.startsWith("row-")) {
      const r = parseInt(pattern.split("-")[1], 10) - 1;
      for (let c = 0; c < 5; c++) winningSet.add(k(r, c));
    } else if (pattern.startsWith("col-")) {
      const c = parseInt(pattern.split("-")[1], 10) - 1;
      for (let r = 0; r < 5; r++) winningSet.add(k(r, c));
    } else if (pattern === "diag-1") {
      for (let i = 0; i < 5; i++) winningSet.add(k(i, i));
    } else if (pattern === "diag-2") {
      for (let i = 0; i < 5; i++) winningSet.add(k(i, 4 - i));
    } else if (pattern === "four-corners") {
      winningSet.add(k(0, 0));
      winningSet.add(k(0, 4));
      winningSet.add(k(4, 0));
      winningSet.add(k(4, 4));
    } else if (pattern === "full-card") {
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 5; c++) winningSet.add(k(r, c));
    }
  }

  const topBorder = "┌" + Array(5).fill("─".repeat(W)).join("┬") + "┐";
  const midBorder = "├" + Array(5).fill("─".repeat(W)).join("┼") + "┤";
  const bottomBorder = "└" + Array(5).fill("─".repeat(W)).join("┴") + "┘";

  const lines = [topBorder];

  // Header
  const headers = ["B", "I", "N", "G", "O"];
  lines.push("│" + headers.map((h) => padCenter(h, W)).join("│") + "│");
  lines.push(midBorder);

  // Rows
  for (let r = 0; r < 5; r++) {
    const cells = [];
    for (let c = 0; c < 5; c++) {
      const v = card[r][c];
      const isFree = r === 2 && c === 2;
      const isWinning = winningSet.has(k(r, c));

      let cellText;
      if (isFree) cellText = "★";
      else if (isWinning) cellText = `[${v}]`;
      else cellText = String(v);

      cells.push(padCenter(cellText, W));
    }
    lines.push("│" + cells.join("│") + "│");
  }

  lines.push(bottomBorder);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════
// 🏆 ለ 50 እና 100 ጨዋታዎች ብቻ የግሩፕ ማሳወቂያ
// ═══════════════════════════════════════════════════════
async function notifyWinnersGroup(game, winnersPanelData) {
  // ለ 50 እና 100 ጨዋታዎች ብቻ
  if (game.entryFee !== 50 && game.entryFee !== 100) return;

  const groupChatId = process.env.WINNERS_GROUP_CHAT_ID;
  if (!groupChatId) {
    console.log("[notify] WINNERS_GROUP_CHAT_ID not set — skip");
    return;
  }

  try {
    const { bot } = require("../bot");
    if (!bot) return;

    const roomCode = game.roomCode;
    const prizePool = game.prizePool;
    const winnerCount = winnersPanelData.length;
    const date = new Date().toLocaleString("en-US", {
      timeZone: "Africa/Addis_Ababa",
    });
    const patternLabel = (game.winPattern || "any-row").toUpperCase();

    let message =
      `🎉🎊 <b>እንኳን ደስ አለዎት!</b> 🎊🎉\n\n` +
      `🏆 <b>Fetan Bingo — ${roomCode}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 ጠቅላላ ሽልማት: <b>${prizePool} ETB</b>\n` +
      `👥 አሸናፊዎች: <b>${winnerCount}</b>\n` +
      `🎯 ፓተርን: <b>${patternLabel}</b>\n` +
      `🕐 ሰዓት: ${date}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    for (let i = 0; i < winnersPanelData.length; i++) {
      const w = winnersPanelData[i];
      const user = await User.findOne({ telegramId: w.telegramId }).select(
        "phone firstName username telegramId"
      );

      const tgName = w.name || "Player";
      const phone = user?.phone || "—";
      const prize = w.prize;

      message += `\n🏅 <b>${tgName}</b>\n`;
      message += `├ 📱 ስልክ: <code>${phone}</code>\n`;
      message += `├ 🆔 Telegram: <code>${w.telegramId}</code>\n`;
      message += `├ 🎴 ካርቴላ: ${w.cartelas
        .map((c) => `#${c}`)
        .join(", ")}\n`;
      message += `└ 💰 ሽልማት: <b>${prize} ETB</b>\n`;

      // 👈 የዚህ ተጠቃሚ ያሸነፉትን ካርቴላዎች አሳይ
      const userCartelas = (game.winningCartelas || []).filter(
        (wc) => String(wc.telegramId) === String(w.telegramId)
      );

      for (const wc of userCartelas) {
        const cartelaArt = renderCartela(wc.card, wc.marked, wc.pattern);
        if (!cartelaArt) continue;

        message +=
          `\n<pre>🏆 CARD #${wc.cardId} — ${String(wc.pattern).toUpperCase()}\n` +
          `${cartelaArt}</pre>\n`;
      }

      if (i < winnersPanelData.length - 1) {
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
      }
    }

    message +=
      `\n━━━━━━━━━━━━━━━━━━━━\n🎱 <b>Fetan Bingo</b> — ያሸንፉ! 💎`;

    // Telegram 4096 char limit
    if (message.length > 4000) {
      message = message.slice(0, 4000) + "\n\n... (truncated)";
    }

    await bot.telegram.sendMessage(groupChatId, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    console.log(
      `[notify] ✅ Winners sent to group for ${roomCode} (${winnerCount} winners)`
    );
  } catch (err) {
    console.error("[notify] ❌ Failed to send to group:", err.message);
  }
}

function initGameSocket(io) {
  const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 1000);

  const CALL_INTERVAL_MS = 400;
  const EMPTY_GAME_INTERVAL_MS = 300;
  const FIRST_CALL_DELAY_MS = 300;
  const WINNER_DISPLAY_MS = 5000;
  const EMPTY_GAME_RESET_MS = 1500;
  const SELECTION_TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);

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
        startedAt: { $lt: new Date(Date.now() - 3 * 60 * 1000) },
      });
      for (const g of stale) {
        console.log(`[auto-starter] Stale reset: ${g.roomCode}`);
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
          g.scheduledStart = getNextDailyStart(getWeeklyFee(g.roomCode));
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
            newGame.scheduledStart = getNextDailyStart(fee);
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
    if (!game.players || game.players.length === 0) return false;

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
  // PROCESS WINNERS — 5s display + Group notification
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

    // 🎉 Emit BINGO popup
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

    console.log(
      `[processWinners] ${game.roomCode} — ${winnersPanelData.length} winner(s)`
    );

    // 🏆 ለ 50 እና 100 ጨዋታዎች ብቻ ወደ ግሩፕ ላክ (background — non-blocking)
    if (game.entryFee === 50 || game.entryFee === 100) {
      notifyWinnersGroup(game, winnersPanelData).catch((err) =>
        console.error("[notify] Unhandled:", err.message)
      );
    }

    // 🎯 5s → reset → back to cartela
    setTimeout(
      () => resetRoom(io, game.roomCode, "winner", WINNER_DISPLAY_MS),
      WINNER_DISPLAY_MS
    );
  }

  // ═══════════════════════════════════════════════════════
  // RESET ROOM
  // ═══════════════════════════════════════════════════════
  async function resetRoom(io, roomCode, reason = "unknown", delayMs = 0) {
    const doReset = async () => {
      try {
        const fresh = await Game.findOne({ roomCode });
        if (!fresh) return;

        if (fresh.status !== "finished") {
          fresh.status = "finished";
          fresh.finishedAt = new Date();
          await fresh.save();
        }

        for (const p of fresh.players) {
          await User.findByIdAndUpdate(p.user, { $inc: { gamesPlayed: 1 } });
        }

        io.to(roomCode).emit("game_over", {
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
          reason,
          nextGameAt: new Date(Date.now() + 500),
        });

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
          fresh.scheduledStart = getNextDailyStart(
            getWeeklyFee(fresh.roomCode)
          );
          fresh.selectionEndsAt = undefined;
        } else {
          fresh.selectionEndsAt = new Date(Date.now() + SELECTION_TIMER_MS);
        }
        await fresh.save();

        io.to(roomCode).emit("next_game_ready", { roomCode });
        io.to(roomCode).emit("room_state", buildRoomState(fresh));

        console.log(`[resetRoom] ${roomCode} — reason: ${reason} — done`);
      } catch (err) {
        console.error(`[resetRoom:${roomCode}]`, err);
      }
    };

    if (delayMs > 0) {
      setTimeout(doReset, delayMs);
    } else {
      await doReset();
    }
  }

  // ═══════════════════════════════════════════════════════
  // START GAME
  // ═══════════════════════════════════════════════════════
  async function startGame(io, roomCode) {
    if (activeCallers.has(roomCode)) {
      console.log(`[startGame] ${roomCode} already active — skip`);
      return;
    }
    activeCallers.set(roomCode, null);

    try {
      const game = await Game.findOne({ roomCode });
      if (!game || game.status !== "waiting") {
        activeCallers.delete(roomCode);
        return;
      }

      const playerCount = game.players.length;
      const hasPlayers = playerCount > 0;

      const intervalMs = hasPlayers
        ? CALL_INTERVAL_MS
        : EMPTY_GAME_INTERVAL_MS;

      game.status = "active";
      game.startedAt = new Date();
      game.calledNumbers = [];
      game.winners = [];
      game.winningCartelas = [];
      game.winPattern = getPatternForRoom(game.entryFee);
      game.selectionEndsAt = undefined;
      await game.save();

      console.log(
        `[startGame] ${roomCode} — ${playerCount} player(s) — ${
          hasPlayers ? "400ms" : "300ms"
        } — pattern: ${game.winPattern}`
      );

      io.to(roomCode).emit("game_started", {
        roomCode,
        winPattern: game.winPattern,
        playerCount,
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

          const currentInterval =
            g.players.length > 0 ? CALL_INTERVAL_MS : EMPTY_GAME_INTERVAL_MS;

          const num = randomUncalled(g.calledNumbers, g.maxNumber);
          if (num === null) {
            active = false;
            activeCallers.delete(roomCode);
            console.log(
              `[caller:${roomCode}] All 75 called — no winner — reset`
            );
            resetRoom(io, roomCode, "all-called", EMPTY_GAME_RESET_MS);
            return;
          }

          if (g.calledNumbers.includes(num)) {
            const h = setTimeout(runCaller, currentInterval);
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

          if (g.players.length > 0) {
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
          }

          io.to(roomCode).emit("number_called", {
            number: num,
            letter,
            calledNumbers: g.calledNumbers,
            winPattern: g.winPattern,
          });

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
          const currentInterval = await Game.findOne({ roomCode }).then((g) =>
            g?.players.length > 0 ? CALL_INTERVAL_MS : EMPTY_GAME_INTERVAL_MS
          );
          const h = setTimeout(runCaller, currentInterval);
          activeCallers.set(roomCode, h);
        }
      };

      const initial = setTimeout(runCaller, FIRST_CALL_DELAY_MS);
      activeCallers.set(roomCode, initial);
    } catch (err) {
      console.error(`[startGame:${roomCode}]`, err);
      activeCallers.delete(roomCode);
    }
  }
}

module.exports = { initGameSocket, getActiveUserCount };