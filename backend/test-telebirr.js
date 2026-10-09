// backend/test-telebirr.js
const { parseTelebirrSms } = require("./services/telebirr/smsParser");
const { verifyReceipt } = require("./services/telebirr/receiptVerifier");

const sampleSms = `Dear Abebe, You have transferred ETB 100.00 to Fetan Bingo - 2519****0583 on 08/10/2026 08:31:50. Your transaction number is DJ85JP3L6V. The service fee is ETB 0.00 and 15% VAT ETB 0.00 on the service fee. Your current E-Money Account balance is ETB 250.50. https://transactioninfo.ethiotelecom.et/receipt/DJ85JP3L6V Thank you`;

(async () => {
  console.log("═══ 1. SMS Parser ═══");
  const parsed = parseTelebirrSms(sampleSms);
  console.log(JSON.stringify(parsed, null, 2));

  if (!parsed.ok) {
    console.log("❌ Parse failed:", parsed.errors);
    return;
  }

  console.log("\n═══ 2. Online Verify ═══");
  try {
    const result = await verifyReceipt({
      txnId: parsed.txnId,
      expectedAmount: parsed.amount,
      smsTimestampMs: parsed.timestamp?.ms,
      merchant: { phone: "0920790583", name: "Fetan Bingo" },
      maxAgeHours: 24,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Verify error:", err.message);
  }
})();