const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    telegramId: { type: String, required: true, unique: true, index: true },
    username: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    photoUrl: { type: String },
    phone: { type: String, default: null },
    balance: { type: Number, default: 0 },
    bonusBalance: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 },
    totalWinnings: { type: Number, default: 0 },
    totalDeposits: { type: Number, default: 0 },
    totalWithdrawals: { type: Number, default: 0 },
    referredBy: { type: String },
    referralCount: { type: Number, default: 0 },
    // 👈 አዲስ
    achievements: { type: [String], default: [] },
    lastActiveAt: { type: Date, default: Date.now },
    notificationReadAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);