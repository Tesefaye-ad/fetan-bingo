const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════
// USER SCHEMA
// ═══════════════════════════════════════════════════════
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
    achievements: { type: [String], default: [] },
    lastActiveAt: { type: Date, default: Date.now },
    notificationReadAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);

// ═══════════════════════════════════════════════════════
// NOTIFICATION SCHEMA (ከ models/Notification.js የተዋሃደ)
// ═══════════════════════════════════════════════════════
const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    title: { type: String, required: true },
    body: { type: String, required: true },
    type: {
      type: String,
      enum: ["info", "success", "warning", "prize", "deposit", "withdraw"],
      default: "info",
    },
    isRead: { type: Boolean, default: false },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

NotificationSchema.index({ user: 1, createdAt: -1 });
const Notification = mongoose.model("Notification", NotificationSchema);

module.exports = User;
module.exports.User = User;
module.exports.Notification = Notification;