const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "deposit",
        "withdrawal",
        "entry_fee",
        "prize",
        "refund",
        "transfer_in",
        "transfer_out",
      ],
      required: true,
    },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reference: { type: String },
    game: { type: mongoose.Schema.Types.ObjectId, ref: "Game" },
    counterparty: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// ═══════════════════════════════════════════════════════
// UNIQUE INDEXES — ድርብ ክፍያ የመጨረሻ ዘብ
// ═══════════════════════════════════════════════════════

// Telebirr Transaction ID — አንድ ጊዜ ብቻ
TransactionSchema.index(
  { "meta.transactionId": 1 },
  {
    unique: true,
    name: "uniq_tx_id",
    partialFilterExpression: { "meta.transactionId": { $type: "string" } },
  }
);

// SMS fingerprint — አንድ ጊዜ ብቻ
TransactionSchema.index(
  { "meta.smsFingerprint": 1 },
  {
    unique: true,
    name: "uniq_sms_fingerprint",
    partialFilterExpression: { "meta.smsFingerprint": { $type: "string" } },
  }
);

// User + Time (ለታሪክ ገጽ)
TransactionSchema.index(
  { user: 1, createdAt: -1 },
  { name: "idx_user_created" }
);

// Type + Status + Time (ለ Admin panel)
TransactionSchema.index(
  { type: 1, status: 1, createdAt: -1 },
  { name: "idx_type_status_created" }
);

// ═══════════════════════════════════════════════════════
// 👈 CLEANUP INDEX — ለ cleanup cron (2 ሳምንት አንድ ጊዜ)
// ═══════════════════════════════════════════════════════
TransactionSchema.index(
  { status: 1, createdAt: 1 },
  { name: "idx_status_created_cleanup" }
);

module.exports = mongoose.model("Transaction", TransactionSchema);