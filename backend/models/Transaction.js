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
// 👈 INDEXES — ተደጋጋሚ SMS እና Transaction ID ለመለየት
// ═══════════════════════════════════════════════════════
// • smsFingerprint  — አንድ SMS ሁለት ጊዜ እንዳይመዘገብ (UNIQUE)
// • transactionId   — አንድ Telebirr Tx ID ሁለት ጊዜ እንዳይመዘገብ
// ═══════════════════════════════════════════════════════

// 👈 ተመሳሳይ SMS ሁለት ጊዜ — SPARSE + UNIQUE
// (Sparse = መስኩ የሌለው transaction አይቆጠርም)
TransactionSchema.index(
  { "meta.smsFingerprint": 1 },
  {
    unique: true,
    sparse: true,
    name: "uniq_sms_fingerprint",
    partialFilterExpression: {
      "meta.smsFingerprint": { $type: "string" },
    },
  }
);

// 👈 ተመሳሳይ Telebirr Transaction ID — SPARSE
TransactionSchema.index(
  { "meta.transactionId": 1 },
  {
    sparse: true,
    name: "idx_tx_id",
    partialFilterExpression: {
      "meta.transactionId": { $type: "string" },
    },
  }
);

// 👈 ተጠቃሚ + ጊዜ — ለታሪክ ገጽ (History page) ፈጣን query
TransactionSchema.index(
  { user: 1, createdAt: -1 },
  { name: "idx_user_created" }
);

// 👈 Status + Type — ለ Admin panel ፈጣን query
TransactionSchema.index(
  { type: 1, status: 1, createdAt: -1 },
  { name: "idx_type_status_created" }
);

module.exports = mongoose.model("Transaction", TransactionSchema);