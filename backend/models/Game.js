const mongoose = require("mongoose");

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

const GameSchema = new mongoose.Schema(
  {
    roomCode: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["waiting", "active", "finished"],
      default: "waiting",
    },
    entryFee: { type: Number, default: 10 },
    prizePool: { type: Number, default: 0 }, // Derash (80%)
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
    winningCartelas: [
      {
        telegramId: String,
        name: String,
        cardId: Number,
        pattern: String,
        card: [[Number]],
        marked: [[Boolean]],
      },
    ],
    // Regular games — countdown
    selectionEndsAt: { type: Date },
    // Weekly games (ROOM50, ROOM100)
    isWeeklyGame: { type: Boolean, default: false },
    scheduledStart: { type: Date },
    // Timestamps
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Game", GameSchema);