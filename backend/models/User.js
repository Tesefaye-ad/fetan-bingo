const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    telegramId: { type: String, required: true, unique: true, index: true },
    username: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    photoUrl: { type: String },
    balance: { type: Number, default: 0 }, // stored in ETB (Birr)
    bonusBalance: { type: Number, default: 0 }, // promotional/referral bonus, must be converted before use
    isBanned: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 },
    referredBy: { type: String }, // telegramId of the inviter, if any
    referralCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
