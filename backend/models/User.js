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

// 👈 የተስተካከለ — index ከ field ውስጥ ተወግዶ ከ Schema በኋላ
UserSchema.index({ telegramId: 1 }, { name: "idx_telegram_id" });
UserSchema.index({ isBanned: 1 }, { name: "idx_banned" });

const User = mongoose.model("User", UserSchema);

// ═══════════════════════════════════════════════════════
// NOTIFICATION SCHEMA
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

// ለታሪክ ገጽ
NotificationSchema.index({ user: 1, createdAt: -1 });

// ═══════════════════════════════════════════════════════
// 👈 TTL — አሮጌ notifications በራሳቸው ይጠፋሉ (30 ቀናት)
// ═══════════════════════════════════════════════════════
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, name: "ttl_notifications" }
);

const Notification = mongoose.model("Notification", NotificationSchema);

module.exports = User;
module.exports.User = User;
module.exports.Notification = Notification;