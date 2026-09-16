const mongoose = require("mongoose");

const PlayerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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
      enum: ["waiting", "active", "finished", "cancelled"],
      default: "waiting",
    },
    entryFee: { type: Number, default: 0 },
    prizePool: { type: Number, default: 0 },
    maxNumber: { type: Number, default: 75 },
    calledNumbers: { type: [Number], default: [] },
    players: { type: [PlayerSchema], default: [] },
    allCards: { type: [CardSchema], default: [] },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    winPattern: { type: String },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Game", GameSchema);