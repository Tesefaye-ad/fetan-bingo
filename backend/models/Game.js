const mongoose = require("mongoose");

const PlayerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    card: { type: [[Number]], required: true }, // 5x5 grid, 0 = FREE space
    marked: { type: [[Boolean]], required: true }, // 5x5 grid of marked cells
    hasWon: { type: Boolean, default: false },
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
    maxNumber: { type: Number, default: 75 }, // 75-ball bingo
    calledNumbers: { type: [Number], default: [] },
    players: { type: [PlayerSchema], default: [] },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    winPattern: { type: String }, // e.g. "row-2", "column-4", "diagonal-1", "full-card"
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Game", GameSchema);
