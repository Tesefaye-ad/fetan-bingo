"use strict";
// ═══════════════════════════════════════════════════════
// CLEANUP — አሮጌ ውሂብ ማጥፋት (በየቀኑ በራሱ ይሰራል)
// ═══════════════════════════════════════════════════════
// 🔴 SECURITY INVARIANTS (do NOT violate):
//
//   1) Completed deposit/withdrawal/prize/transfer transactions
//      ፈጽሞ አይጠፉም — replay attack ለመከላከል እና የገንዘብ ኦዲት ለማስቀመጥ
//
//   2) ANY transaction with meta.transactionId OR meta.smsFingerprint
//      ፈጽሞ አይጠፋም — unique index ስለሌለው replay attack ይቻላል
//      (uniq_tx_id + uniq_sms_fingerprint በ Transaction model ላይ)
//
//   3) Pending withdrawals ፈጽሞ አይጠፉም — ገንዘብ ከተጠቃሚው
//      ተቀንሶ ይቀመጣል፤ መዝገቡ ቢጠፋ ብሩ ይጠፋል
//
//   4) Pending deposits with requiresManualReview=true ፈጽሞ
//      አይጠፉም — admin እስኪወስን ድረስ ይቆያሉ
// ═══════════════════════════════════════════════════════
const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const Game = require("../models/Game");
const { Notification } = require("../models/User");

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const RETENTION = {
  notifications: 7 * DAY,
  transactionsFailed: 14 * DAY,
  gamesFinished: 30 * DAY,      // 🔴 7 → 30 (audit trail)
  gamesWaitingStale: 1 * DAY,
  pendingDepositExpire: 1 * HOUR, // mark failed — don't delete
};

async function cleanup() {
  const now = Date.now();
  const result = { startedAt: new Date().toISOString() };

  // ─────────────────────────────────────────────────────
  // 1️⃣ Notifications — 7 ቀን
  // ─────────────────────────────────────────────────────
  try {
    const r = await Notification.deleteMany({
      createdAt: { $lt: new Date(now - RETENTION.notifications) },
    });
    result.notifications = r.deletedCount;
  } catch (e) {
    result.notificationsError = e.message;
  }

  // ─────────────────────────────────────────────────────
  // 2️⃣ Stale pending deposits → MARK FAILED (don't delete!)
  //    Frees MAX_PENDING_DEPOSITS quota so user can retry
  //    without waiting days. Protects unique indexes.
  // ─────────────────────────────────────────────────────
  try {
    const r = await Transaction.updateMany(
      {
        type: "deposit",
        status: "pending",
        // 🔴 NEVER touch deposits with replay-protection keys
        "meta.transactionId": { $exists: false },
        "meta.smsFingerprint": { $exists: false },
        // 🔴 NEVER touch deposits awaiting admin review
        "meta.requiresManualReview": { $ne: true },
        createdAt: { $lt: new Date(now - RETENTION.pendingDepositExpire) },
      },
      {
        $set: {
          status: "failed",
          "meta.expiredAt": new Date(),
          "meta.rejectReason": "expired_pending_deposit",
        },
      }
    );
    result.expiredPendingDeposits = r.modifiedCount;
  } catch (e) {
    result.expiredPendingDepositsError = e.message;
  }

  // ─────────────────────────────────────────────────────
  // 3️⃣ Failed transactions — 14 ቀን
  //    🔴 Only those WITHOUT replay-protection keys.
  //    A "failed" deposit that still has meta.transactionId
  //    is intentional (queueManualReview path) — keep it.
  // ─────────────────────────────────────────────────────
  try {
    const r = await Transaction.deleteMany({
      status: "failed",
      "meta.transactionId": { $exists: false },
      "meta.smsFingerprint": { $exists: false },
      createdAt: { $lt: new Date(now - RETENTION.transactionsFailed) },
    });
    result.failedTransactions = r.deletedCount;
  } catch (e) {
    result.failedTransactionsError = e.message;
  }

  // ─────────────────────────────────────────────────────
  // 4️⃣ Other pending (non-withdrawal, non-deposit) — defensive
  //    entry_fee/prize/refund/transfer are always "completed"
  //    in the current codebase, but keep as safety net.
  // ─────────────────────────────────────────────────────
  try {
    const r = await Transaction.deleteMany({
      status: "pending",
      type: { $nin: ["deposit", "withdrawal"] },
      createdAt: { $lt: new Date(now - RETENTION.transactionsFailed) },
    });
    result.stalePendingOther = r.deletedCount;
  } catch (e) {
    result.stalePendingOtherError = e.message;
  }

  // ─────────────────────────────────────────────────────
  // 5️⃣ Finished games — 30 ቀን
  //    🔴 Only delete if payout was completed (paidAt set)
  //    and no pending notification (notifiedAt not null).
  //    NOTE: current codebase never sets status="finished"
  //    (games are reset to "waiting"), so this is defensive
  //    for when history archival is added.
  // ─────────────────────────────────────────────────────
  try {
    const cutoff = new Date(now - RETENTION.gamesFinished);
    const r = await Game.deleteMany({
      status: "finished",
      finishedAt: { $lt: cutoff },
      // paidAt must be set (either explicitly or absent for legacy docs)
      $or: [
        { paidAt: { $ne: null } },
        { paidAt: { $exists: false } },
      ],
    });
    result.games = r.deletedCount;
  } catch (e) {
    result.gamesError = e.message;
  }

  // ─────────────────────────────────────────────────────
  // 6️⃣ Stale waiting rooms — 1 ቀን (ካርድ የሌላቸው)
  // ─────────────────────────────────────────────────────
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