const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const { requireAuth } = require("./auth");
const rooms = require("../services/rooms");

const router = express.Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════
// 👈 ቀላል የቀድ cache — 6000 ተጠቃሚ ተመሳሳይ ክፍል ሲጠይቁ
//     TTL 250ms በቂ ነው (socket አዲስ ሁኔታ ሲኖር ይልካል)
// ═══════════════════════════════════════════════════════
const roomCache = new Map(); // roomCode -> { state, expiresAt }
const CACHE_TTL_MS = 250;
const CACHE_MAX = 20; // 👈 የ 4 ክፍሎች + ሌሎች

function getCached(roomCode) {
  const c = roomCache.get(roomCode);
  if (!c) return null;
  if (Date.now() > c.expiresAt) {
    roomCache.delete(roomCode);
    return null;
  }
  return c.state;
}

function setCached(roomCode, state) {
  // ካሽ ከመጠን በላይ ከሆነ ጥንታዊውን አስወግድ
  if (roomCache.size >= CACHE_MAX) {
    const firstKey = roomCache.keys().next().value;
    roomCache.delete(firstKey);
  }
  roomCache.set(roomCode, {
    state,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ═══════════════════════════════════════════════════════
// የክፍሉ ሁኔታ — ሰዓቱን ፈጽሞ አይቀይርም
// ═══════════════════════════════════════════════════════
async function sendRoom(req, res, status = 200) {
  try {
    const roomCode = rooms.normalizeRoomCode(
      req.params.roomCode || req.body?.roomCode
    );
    if (!roomCode) {
      return res.status(404).json({ error: "Unknown room" });
    }

    // 👈 cache ተመልከት
    const cached = getCached(roomCode);
    if (cached) {
      res.set("Cache-Control", "no-store, max-age=0");
      res.set("X-Cache", "HIT");
      return res.status(status).json(cached);
    }

    const game = await rooms.ensureRoom(roomCode);
    if (!game) {
      return res.status(404).json({ error: "Room not found" });
    }

    const state = rooms.publicState(game);
    const payload = {
      ...state,
      // 👈 remainingMs ተካቷል (server) — client ራሱ ሰከንድ ያሰላል
      //    remainingSeconds ሳያስፈልግ
    };

    setCached(roomCode, payload);

    res.set("Cache-Control", "no-store, max-age=0");
    res.set("X-Cache", "MISS");
    res.status(status).json(payload);
  } catch (err) {
    console.error("[game route]", err);
    res.status(500).json({ error: "Could not load room" });
  }
}

router.get("/rooms/:roomCode", (req, res) => sendRoom(req, res, 200));
router.post("/rooms", (req, res) => sendRoom(req, res, 201));

// ═══════════════════════════════════════════════════════
// STATS — ካሽ ጋር (በ admin panel ብቻ ይጠቀማል)
// ═══════════════════════════════════════════════════════
let statsCache = null;
let statsCacheAt = 0;
const STATS_CACHE_MS = 30000; // 30 ሰከንድ

router.get("/stats", async (req, res) => {
  try {
    const now = Date.now();
    if (statsCache && now - statsCacheAt < STATS_CACHE_MS) {
      return res.json(statsCache);
    }

    const [totalUsers, totalGames] = await Promise.all([
      User.estimatedDocumentCount(), // 👈 countDocuments → estimatedDocumentCount (ፈጣን)
      Game.estimatedDocumentCount(),
    ]);

    statsCache = { totalUsers, totalGames };
    statsCacheAt = now;
    res.json(statsCache);
  } catch (err) {
    console.error("[game/stats]", err);
    res.status(500).json({ error: "Could not load stats" });
  }
});

// ═══════════════════════════════════════════════════════
// 👈 ROOM STATE CACHE INVALIDATION (socket ሞተር ሲጠራ)
// ═══════════════════════════════════════════════════════
function invalidateRoomCache(roomCode) {
  if (roomCode) roomCache.delete(roomCode);
  else roomCache.clear();
}

module.exports = router;
module.exports.invalidateRoomCache = invalidateRoomCache;