"use strict";
// የመርቻንት ስልክ የተቀበለው የቴሌብር SMS (ከ SMS Forwarder መተግበሪያ የሚመጣ)
const mongoose = require("mongoose");

const MerchantSmsSchema = new mongoose.Schema(
  {
    txnId: { type: String, required: true, unique: true, index: true },
    amount: { type: Number, required: true },
    senderName: { type: String },
    senderPhone: { type: String },
    smsTimestampMs: { type: Number },
    smsTimestampRaw: { type: String },
    from: { type: String },
    raw: { type: String },
    fingerprint: { type: String },
    // ጥቅም ላይ የዋለ ከሆነ የማን ክፍያ እንደሆነ
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    claimedAt: { type: Date },
  },
  { timestamps: true }
);

// ከ60 ቀን በኋላ በራስ ሰር ይሰረዛል (የ Transaction መዝገቡ ግን ይቀራል)
MerchantSmsSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 });

module.exports =
  mongoose.models.MerchantSms || mongoose.model("MerchantSms", MerchantSmsSchema);