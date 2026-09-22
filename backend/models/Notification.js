const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // null = broadcast to all
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

module.exports = mongoose.model("Notification", NotificationSchema);