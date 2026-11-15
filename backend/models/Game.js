const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════
// SUB-SCHEMAS
// ═══════════════════════════════════════════════════════
const PlayerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    telegramId: { type: String },
    cardId: { type: Number, required: true },
    card: { type: [[Number]], required: true },
    marked: { type: [[Boolean]], required: true },
    hasWon: { type: Boolean, default: false },
  },
  { _id: false }
);

const CardSchema = new mongoose.Schema(
  {
    cardId: { type: Number, required: true },
    card: { type: [[Number]], required: true },
    marked: { type: [[Boolean]], required: true },
  },
  { _id: false }
);

const WinningCartelaSchema = new mongoose.Schema(
  {
    // userId: ለ Resume/Payout ማዕከላዊ ቁልፍ (አስፈላጊ ነው!)
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    telegramId: { type: String },
    name: { type: String },
    cardId: { type: Number, required: true },
    pattern: { type: String },
    card: { type: [[Number]] },
    marked: { type: [[Boolean]] },
    prize: { type: Number }, // በወቅቱ የተሰላ ደራሽ (ለታሪክ መዝገብ)
  },
  { _id: false }
);

// ═══════════════════════════════════════════════════════
// MAIN GAME SCHEMA
// ═══════════════════════════════════════════════════════
const GameSchema = new mongoose.Schema(
  {
    roomCode: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["waiting", "active", "finished"],
      default: "waiting",
    },
    entryFee: { type: Number, default: 10 },
    prizePool: { type: Number, default: 0 },
    maxNumber: { type: Number, default: 75 },
    calledNumbers: { type: [Number], default: [] },
    players: { type: [PlayerSchema], default: [] },
    reservedCards: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        telegramId: String,
        cardId: Number,
      },
    ],
    allCards: { type: [CardSchema], default: [] },
    winners: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    
    // 🔴 ለእያንዳንዱ ጨዋታ ዙር ልዩ የሆነ መለያ (Idempotency Key)
    roundId: { type: String, default: () => new mongoose.Types.ObjectId().toString() },

    // 🔴 አሸናፊ ካርቴላዎች (Idempotent Payout ለማድረግ)
    winningCartelas: { type: [WinningCartelaSchema], default: [] },

    winPattern: {
      type: String,
      enum: [
        "any-row",
        "any-column",
        "any-diagonal",
        "four-corners",
        "full-card",
      ],
      default: "any-row",
    },
    selectionEndsAt: { type: Date },
    isWeeklyGame: { type: Boolean, default: false },
    scheduledStart: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },

    // 🔴 ለ Crash-Resume (ሰርቨሩ ሲወድቅ እንደገና ለመክፈል)
    notifiedAt: { type: Date, default: null }, // የቴሌግራም ማሳወቂያ የተላከበት ሰዓት
    paidAt: { type: Date, default: null },     // ደራሹ ለሁሉም የተከፈለበት ሰዓት
  },
  { timestamps: true }
);

// ═══════════════════════════════════════════════════════
// INDEXES (ለፍጥነት እና ለዳታቤዝ ጥራት)
// ═══════════════════════════════════════════════════════

// 1. የክፍል ሁኔታን በፍጥነት ለመፈለግ
GameSchema.index({ status: 1, roomCode: 1 }, { name: "idx_status_room" });

// 2. የተጠናቀቁ ጨዋታዎችን በሰዓት ለመለየት (ለCleanup)
GameSchema.index({ status: 1, finishedAt: -1 }, { name: "idx_status_finished" });

// 3. የተጠቃሚ ታሪክ ለመመልከት
GameSchema.index(
  { "players.user": 1, status: 1, finishedAt: -1 },
  { name: "idx_user_history" }
);

// 4. ያልተጫወቱ ክፍሎችን ለማጽዳት
GameSchema.index(
  { status: 1, "reservedCards.0": 1, updatedAt: 1 },
  { name: "idx_stale_waiting" }
);

// 5. 🔴 ለ Payout Resume (ሰርቨሩ ሲወድቅ ያልተከፈለውን ለማግኘት)
GameSchema.index(
  { paidAt: 1, status: 1 },
  { name: "idx_payout_status" }
);

module.exports = mongoose.model("Game", GameSchema);