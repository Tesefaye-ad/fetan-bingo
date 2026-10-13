"use strict";
// ═══════════════════════════════════════════════════════
// የደረሰኝ ማረጋገጫ መመርመሪያ — ሰርቨርዎ ላይ ያስኬዱ:
//   node scripts/testReceipt.js DJD9QEFDFL [መጠን]
// ምን እንደሚያደርግ: ደረሰኙን ከኢትዮ ቴሌኮም ያመጣል፣ ያነባል፣ እና ካልተሳካ ትክክለኛውን ምክንያት ይነግርዎታል።
// ═══════════════════════════════════════════════════════
try { require("dotenv").config(); } catch {}
const r = require("../services/telebirr/receiptVerifier");

const HINTS = [
  [/UNABLE_TO_VERIFY|CERT_|SELF_SIGNED|ISSUER/i,
   "SSL ሰንሰለት ችግር → የኢትዮ ቴሌኮምን የጎደለ CA (.pem) ያውርዱና RECEIPT_CA_FILE=/path/ca.pem ይበሉ (ወይም NODE_EXTRA_CA_CERTS)።"],
  [/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|socket hang up|timeout/i,
   "ኔትወርክ ተዘግቷል → ኢትዮ ቴሌኮም የሰርቨርዎን IP (በተለይ የውጭ ሀገር/ዳታሴንተር) ሊያግድ ይችላል። ሰርቨሩን ኢትዮጵያ ውስጥ ያድርጉ ወይም በኢትዮጵያ IP በኩል proxy ይጠቀሙ።"],
  [/ENOTFOUND|EAI_AGAIN/i, "DNS ችግር → ሰርቨሩ transactioninfo.ethiotelecom.et ማግኘት አይችልም።"],
  [/status_403|status_429|status_401/i, "ጣቢያው ሪኬስቱን ከልክሏል (bot ጥበቃ ወይም IP ማገድ)።"],
];

(async () => {
  const id = (process.argv[2] || "").trim();
  const amount = process.argv[3] ? Number(process.argv[3]) : null;
  if (!id) { console.log("አጠቃቀም: node scripts/testReceipt.js <የግብይት ቁጥር> [መጠን]"); process.exit(1); }

  console.log("URL        :", r.buildReceiptUrl(id));
  console.log("CA ፋይል    :", process.env.RECEIPT_CA_FILE || "(የለም)");
  const t0 = Date.now();
  const f = await r.fetchReceiptHtml(id);
  console.log(`ማምጣት     : ${f.ok ? "✅ ተሳክቷል" : "❌ አልተሳካም"} (${Date.now() - t0}ms)`,
    f.notFound ? "— 404: ደረሰኝ የለም (ሃሰተኛ ቁጥር)" : "", f.error ? `\nስህተት     : ${f.error}` : "");
  if (!f.ok) {
    const h = HINTS.find(([re]) => re.test(String(f.error)));
    if (h) console.log("\n👉 ምክንያት/መፍትሄ:", h[1]);
    process.exit(2);
  }
  console.log("HTML ርዝመት:", f.html.length);
  const d = r.parseReceiptHtml(f.html);
  console.log("\nየተነበበ:", JSON.stringify({
    invoiceNo: d.invoiceNo, paymentDate: d.paymentDate, amount: d.amount, status: d.status,
    payer: d.payerName, payerPhone: d.payerPhone, recipient: d.recipientName, recipientPhone: d.recipientPhone,
  }, null, 2));
  if (!d.invoiceNo || d.amount == null) {
    console.log("\n❌ ገጹ ደርሷል ግን መነበብ አልቻለም → የገጹ አወቃቀር ከተጠበቀው ይለያል። የሚከተለውን ፋይል ይላኩልኝ: /tmp/receipt_debug.html");
    require("fs").writeFileSync("/tmp/receipt_debug.html", f.html);
    process.exit(3);
  }
  if (amount != null) {
    const v = await r.verifyReceipt({
      txnId: id, expectedAmount: amount,
      merchant: { phone: process.env.DEPOSIT_TELEBIRR_PHONE, name: process.env.DEPOSIT_TELEBIRR_NAME },
    });
    console.log("\nሙሉ ማረጋገጫ:", v.ok ? "✅ ያልፋል" : `❌ ${v.reason} — ${v.message}`);
  }
})();
