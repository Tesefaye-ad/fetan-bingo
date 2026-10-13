"use strict";
// ═══════════════════════════════════════════════════════
// CLEANUP — አሮጌ ውሂብ ማጥፋት (በየ 2 ሳምንቱ በራሱ ይሰራል)
// ═══════════════════════════════════════════════════════
const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const Game = require("../models/Game");
const { Notification } = require("../models/User");

const DAY = 24 * 60 * 60 * 1000;

// ─── የማጥፊያ ዕድሜዎች ───

const RETENTION = {
  notifications: 7 * DAY,              // 30 → 7
  transactionsCompleted: 90 * DAY,     // 180 → 90
  transactionsFailed: 14 * DAY,        // 30 → 14
  gamesFinished: 7 * DAY,             // 60 → 14
  gamesWaitingStale: 1 * DAY,          // 7 → 1
};

async function cleanup() {
  const now = Date.now();
  const result = { startedAt: new Date().toISOString() };

  // 1️⃣ Notifications — 30 ቀናት በላይ (TTL index ቢረዳም እዚህ ደግሞ አረጋግጥ)
  try {
    const r = await Notification.deleteMany({
      createdAt: { $lt: new Date(now - RETENTION.notifications) },
    });
    result.notifications = r.deletedCount;
  } catch (e) {
    result.notificationsError = e.message;
  }

  // 2️⃣ Transactions — የተጠናቀቁ 6 ወር፣ የተሳሳቱ 1 ወር
  try {
    const r1 = await Transaction.deleteMany({
      status: "completed",
      createdAt: { $lt: new Date(now - RETENTION.transactionsCompleted) },
    });
    // ⚠️ pending withdrawal ፈጽሞ አይጠፋም — ብሩ ከተጠቃሚው ቀድሞ ተቀንሷል፤
    //    መዝገቡ ቢጠፋ ተጠቃሚው ብሩን ያጣል (ማንም ሊመልስለት አይችልም)
    const r2 = await Transaction.deleteMany({
      $or: [
        { status: "failed" },
        { status: "pending", type: { $ne: "withdrawal" } },
      ],
      createdAt: { $lt: new Date(now - RETENTION.transactionsFailed) },
    });
    result.transactions = r1.deletedCount + r2.deletedCount;
  } catch (e) {
    result.transactionsError = e.message;
  }

  // 3️⃣ የተጠናቀቁ ጨዋታዎች — 2 ወር
  try {
    const r = await Game.deleteMany({
      status: "finished",
      finishedAt: { $lt: new Date(now - RETENTION.gamesFinished) },
    });
    result.games = r.deletedCount;
  } catch (e) {
    result.gamesError = e.message;
  }

  // 4️⃣ ያልተጫወቱ ክፍሎች — ካርድ የሌላቸው + 1 ሳምንት
  try {
    const r = await Game.deleteMany({
      status: "waiting",
      "reservedCards.0": { $exists: false },
      updatedAt: { $lt: new Date(now - RETENTION.gamesWaitingStale) },
    });
    result.staleRooms = r.deletedCount;
  } catch (e) {
    result.staleRoomsError = e.message;
  }

  result.finishedAt = new Date().toISOString();
  return result;
}

module.exports = { cleanup };

// ─── በቀጥታ ከ CLI ሲጠራ (node scripts/cleanup.js) ───
if (require.main === module) {
  require("dotenv").config();
  (async () => {
    await mongoose.connect(
      process.env.MONGO_URI || process.env.MONGODB_URI
    );
    const r = await cleanup();
    console.log("✅ Cleanup:", JSON.stringify(r, null, 2));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}