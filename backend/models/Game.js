const mongoose = require("mongoose");

const PlayerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cardId: { type: Number, required: true },
    card: { type: [[Number]], required: true },
    marked: { type: [[Boolean]], required: true },
    hasWon: { type: Boolean, default: false },
    isWatching: { type: Boolean, default: false },
  },
  { _id: false }
);

const GameSchema = new mongoose.Schema(
  {
    roomCode: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["waiting", "active", "finished", "cancelled"],
      default: "waiting",
    },
    entryFee: { type: Number, default: 0 },
    prizePool: { type: Number, default: 0 },
    maxNumber: { type: Number, default: 75 },
    calledNumbers: { type: [Number], default: [] },
    players: { type: [PlayerSchema], default: [] },
    reservedCards: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        telegramId: { type: String },
        cardId: { type: Number },
      },
    ],
    allCards: { type: mongoose.Schema.Types.Mixed, default: [] },
    winners: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    winPattern: { type: String },
    // 👈 አዲስ የተጨመረ — ሁሉም ተጫዋች ተመሳሳይ ሰዓት እንዲያዩ
    selectionEndsAt: { type: Date },
    nextGameAt: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Game", GameSchema);