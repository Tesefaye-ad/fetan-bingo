const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["deposit", "withdrawal", "entry_fee", "prize", "refund"],
      required: true,
    },
    amount: { type: Number, required: true }, // always positive; sign implied by type
    balanceAfter: { type: Number, required: true },
    reference: { type: String }, // e.g. Telebirr transaction id
    game: { type: mongoose.Schema.Types.ObjectId, ref: "Game" },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", TransactionSchema);
