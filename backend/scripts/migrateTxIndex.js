"use strict";
// አንድ ጊዜ ብቻ ያሂዱ:  node scripts/migrateTxIndex.js
// meta.transactionId ላይ UNIQUE index ያስቀምጣል — ድርብ ክፍያን የሚያቆመው የመጨረሻው ዘብ ይህ ነው።
require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const col = mongoose.connection.collection("transactions");

  const dups = await col
    .aggregate([
      { $match: { "meta.transactionId": { $type: "string" } } },
      { $group: { _id: "$meta.transactionId", n: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  if (dups.length) {
    console.error(`❌ ${dups.length} ድግግሞሽ ያላቸው Transaction ID ተገኝተዋል — መጀመሪያ በእጅ ያስተካክሉ:`);
    for (const d of dups) console.error(`  ${d._id} → ${d.ids.join(", ")}`);
    process.exit(1);
  }

  const existing = await col.indexes();
  if (existing.some((i) => i.name === "idx_tx_id")) {
    await col.dropIndex("idx_tx_id");
    console.log("🗑  የድሮው idx_tx_id (non-unique) ተሰርዟል");
  }
  await col.createIndex(
    { "meta.transactionId": 1 },
    {
      unique: true,
      name: "uniq_tx_id",
      partialFilterExpression: { "meta.transactionId": { $type: "string" } },
    }
  );
  console.log("✅ uniq_tx_id ተፈጥሯል");
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
