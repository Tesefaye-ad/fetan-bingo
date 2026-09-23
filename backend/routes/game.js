const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const auth = require("./auth");
const { requireAuth } = auth;
const { generate1000Cards } = require("../utils/bingoCard");

const router = express.Router();
router.use(requireAuth);

const TIMER_MS = Number(process.env.SELECTION_TIMER_MS || 50000);

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

function getRoomFeeConfig(roomCode, fallbackFee) {
  if (roomCode === "ROOM50") return { isWeekly: true, fee: 50 };
  if (roomCode === "ROOM100") return { isWeekly: true, fee: 100 };
  return {
    isWeekly: false,
    fee: Number(fallbackFee ?? process.env.ENTRY_FEE ?? 10),
  };
}

router.get("/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    const game = await Game.findOne({ roomCode });
    if (!game) return res.status(404).json({ error: "Room not found" });

    let remainingSeconds = 0;
    if (!game.isWeeklyGame && game.selectionEndsAt) {
      remainingSeconds = Math.max(
        0,
        Math.floor((new Date(game.selectionEndsAt) - Date.now()) / 1000)
      );
    }

    res.json({
      roomCode: game.roomCode,
      status: game.status,
      entryFee: game.entryFee,
      prizePool: game.prizePool,
      playerCount: game.players.length,
      calledNumbers: game.calledNumbers,
      maxNumber: game.maxNumber,
      takenCards: game.players.map((p) => p.cardId),
      reservedCards: (game.reservedCards || []).map((r) => r.cardId),
      selectionEndsAt: game.selectionEndsAt,
      serverTime: new Date().toISOString(),
      remainingSeconds,
      scheduledStart: game.scheduledStart,
      isWeeklyGame: game.isWeeklyGame || false,
      winnersCount: game.winners?.length || 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load room" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalGames = await Game.countDocuments({ status: "finished" });
    res.json({ totalUsers, totalGames });
  } catch (err) {
    res.status(500).json({ error: "Could not load stats" });
  }
});

router.post("/rooms", async (req, res) => {
  try {
    let { roomCode, entryFee } = req.body;
    roomCode = (roomCode || generateRoomCode()).trim().toUpperCase();
    const { isWeekly, fee } = getRoomFeeConfig(roomCode, entryFee);
    let game = await Game.findOne({ roomCode });

    if (!game) {
      const data = {
        roomCode,
        entryFee: fee,
        maxNumber: Number(process.env.BINGO_MAX_NUMBER || 75),
        allCards: generate1000Cards(),
        isWeeklyGame: isWeekly,
      };
      if (isWeekly) {
        data.scheduledStart = getNextWeeklyStart(fee);
      } else {
        data.selectionEndsAt = new Date(Date.now() + TIMER_MS);
      }
      game = await Game.create(data);
    }

    let remainingSeconds = 0;
    if (!game.isWeeklyGame && game.selectionEndsAt) {
      remainingSeconds = Math.max(
        0,
        Math.floor((new Date(game.selectionEndsAt) - Date.now()) / 1000)
      );
    }

    res.status(201).json({
      roomCode: game.roomCode,
      status: game.status,
      entryFee: game.entryFee,
      prizePool: game.prizePool,
      playerCount: game.players.length,
      selectionEndsAt: game.selectionEndsAt,
      serverTime: new Date().toISOString(),
      remainingSeconds,
      scheduledStart: game.scheduledStart,
      isWeeklyGame: game.isWeeklyGame || false,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not create room" });
  }
});

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = router;