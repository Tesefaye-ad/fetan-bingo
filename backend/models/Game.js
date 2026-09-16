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
    // 👇 አዲስ የተጨመረ፦ ለጊዜው የተያዙ ካርዶችን ለመከታተል
    reservedCards: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        cardId: { type: Number },
      },
    ],
    allCards: { type: mongoose.Schema.Types.Mixed, default: [] },
    winners: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    winPattern: { type: String },
    nextGameAt: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Game", GameSchema);