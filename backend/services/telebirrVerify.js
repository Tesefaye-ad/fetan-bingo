// ═══════════════════════════════════════════════════════
// TELEBIRR RECEIPT VERIFIER — 4 የመግቢያ መንገዶች
// ═══════════════════════════════════════════════════════
const axios = require("axios");
const cheerio = require("cheerio");

const RECEIPT_BASE = "https://transactioninfo.ethiotelecom.et/receipt/";
const TIMEOUT = 15000;

// Browser headers
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,am;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

// ═══════════════════════════════════════════════════════
// ዘዴ 1: ቀጥታ ማምጣት (Render IP → Ethio Telecom)
// ═══════════════════════════════════════════════════════
async function fetchDirect(url) {
  try {
    const res = await axios.get(url, {
      timeout: TIMEOUT,
      headers: HEADERS,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 500,
    });
    if (res.status === 200 && res.data && res.data.length > 1000) {
      return { ok: true, html: res.data, via: "direct" };
    }
    return { ok: false, status: res.status, via: "direct" };
  } catch (err) {
    return { ok: false, error: err.message, via: "direct" };
  }
}

// ═══════════════════════════════════════════════════════
// ዘዴ 2: CORS Proxy (allorigins.win — ነፃ)
// ═══════════════════════════════════════════════════════
async function fetchViaAllOrigins(url) {
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await axios.get(proxyUrl, {
      timeout: TIMEOUT,
      headers: { "User-Agent": HEADERS["User-Agent"] },
    });
    if (res.data?.contents && res.data.contents.length > 1000) {
      return { ok: true, html: res.data.contents, via: "allorigins" };
    }
    return { ok: false, via: "allorigins" };
  } catch (err) {
    return { ok: false, error: err.message, via: "allorigins" };
  }
}

// ═══════════════════════════════════════════════════════
// ዘዴ 3: CORS Proxy (corsproxy.io — ነፃ)
// ═══════════════════════════════════════════════════════
async function fetchViaCorsProxy(url) {
  try {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const res = await axios.get(proxyUrl, {
      timeout: TIMEOUT,
      headers: HEADERS,
    });
    if (res.data && res.data.length > 1000) {
      return { ok: true, html: res.data, via: "corsproxy" };
    }
    return { ok: false, via: "corsproxy" };
  } catch (err) {
    return { ok: false, error: err.message, via: "corsproxy" };
  }
}


// ═══════════════════════════════════════════════════════
// 🌐 ሁሉንም ዘዴዎች በቅደም ተከተል ይሞክራል
// ═══════════════════════════════════════════════════════
async function fetchReceiptHTML(transactionId) {
  const url = `${RECEIPT_BASE}${transactionId}`;

  const strategies = [
    { name: "direct", fn: () => fetchDirect(url) },
    { name: "allorigins", fn: () => fetchViaAllOrigins(url) },
    { name: "corsproxy", fn: () => fetchViaCorsProxy(url) },
  ];

  const errors = [];
  for (const strategy of strategies) {
    const result = await strategy.fn();
    if (result.ok) {
      console.log(
        `[verify] ✅ ${transactionId} fetched via ${strategy.name} (${result.html.length} bytes)`
      );
      return result;
    }
    errors.push(`${strategy.name}: ${result.error || result.status || "fail"}`);
    console.log(`[verify] ⚠️ ${transactionId} — ${strategy.name} failed`);
  }

  console.error(`[verify] ❌ All fetch methods failed for ${transactionId}:`, errors.join(" | "));
  return { ok: false, error: "All methods failed", errors };
}

// ═══════════════════════════════════════════════════════
// 📱 የስልክ ቁጥር ማመሳሰል
// ═══════════════════════════════════════════════════════
function phoneMatches(maskedPhone, fullPhone) {
  if (!maskedPhone || !fullPhone) return false;

  let normalized = String(fullPhone).replace(/[^\d]/g, "");
  if (normalized.startsWith("0")) normalized = "251" + normalized.slice(1);
  if (normalized.length === 9 && normalized.startsWith("9")) {
    normalized = "251" + normalized;
  }

  // Handle both masked (2519****0583) and full (251920790583)
  if (maskedPhone.includes("*")) {
    const parts = maskedPhone.split(/\*+/);
    if (parts.length !== 2) return false;
    return normalized.startsWith(parts[0]) && normalized.endsWith(parts[1]);
  }

  // Full comparison
  const other = String(maskedPhone).replace(/[^\d]/g, "");
  return normalized === other || normalized.endsWith(other) || other.endsWith(normalized);
}

// ═══════════════════════════════════════════════════════
// 🔍 ከ HTML መረጃ ማውጣት (ከ screenshot መሰረት)
// ═══════════════════════════════════════════════════════
function parseReceiptHTML(html) {
  const $ = cheerio.load(html);

  // ሁሉንም td cells ሰብስብ
  const cells = [];
  $("td").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) cells.push(text);
  });

  const getValueAfter = (...labels) => {
    for (let i = 0; i < cells.length - 1; i++) {
      const cell = cells[i].toLowerCase();
      for (const label of labels) {
        if (cell.includes(label.toLowerCase())) {
          const next = cells[i + 1];
          if (next && next.trim()) return next.trim();
        }
      }
    }
    return null;
  };

  const data = {
    payerName: getValueAfter("Payer Name", "የከፋይ ስም"),
    payerPhone: getValueAfter("Payer telebirr no", "የከፋይ ቴሌብር"),
    payerAccountType: getValueAfter("Payer account type"),
    recipientName: getValueAfter("Credited Party name", "ተቀባይ ስም"),
    recipientPhone: getValueAfter(
      "Credited party account no",
      "የተቀባይ አካውንት"
    ),
    status: getValueAfter("Transaction status", "የግብይት ሁኔታ"),
    invoiceNo: getValueAfter("Invoice No", "ደረሰኝ ቁጥር"),
    paymentDate: getValueAfter("Payment date", "የክፍያ ቀን"),
    settledAmount: getValueAfter("Settled Amount", "የተከፈለ መጠን"),
    totalPaidAmount: getValueAfter("Total Paid Amount", "ጠቅላላ የተከፈለ"),
    serviceFee: getValueAfter("Service fee"),
    totalInWords: getValueAfter("Total Amount in word"),
  };

  // Amount → number
  let amount = null;
  if (data.settledAmount) {
    const m = String(data.settledAmount).match(/(\d+(?:[.,]\d+)?)/);
    if (m) amount = parseFloat(m[1].replace(",", "."));
  }
  data.amount = amount;

  // Date → ms
  let paymentDateMs = null;
  if (data.paymentDate) {
    const m = String(data.paymentDate).match(
      /(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/
    );
    if (m) {
      const [, d, mo, y, h, mi, s] = m;
      const parsed = new Date(
        `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(
          2,
          "0"
        )}:${mi}:${s}+03:00`
      );
      if (!isNaN(parsed.getTime())) paymentDateMs = parsed.getTime();
    }
  }
  data.paymentDateMs = paymentDateMs;

  return data;
}

// ═══════════════════════════════════════════════════════
// ✅ ሙሉ ማረጋገጫ
// ═══════════════════════════════════════════════════════
async function verifyTelebirrReceipt({
  transactionId,
  expectedAmount,
  expectedRecipientPhone,
  expectedSenderPhone,
  maxAgeHours = 24,
}) {
  if (!transactionId || !/^[A-Z0-9]{6,15}$/i.test(transactionId)) {
    return {
      ok: false,
      reason: "invalid_id",
      message: "❌ የግብይት ቁጥሩ ቅርጸት ትክክል አይደለም",
    };
  }

  // 1. Fetch HTML
  const fetch = await fetchReceiptHTML(transactionId);
  if (!fetch.ok) {
    return {
      ok: false,
      reason: "fetch_failed",
      message: "❌ ደረሰኙን ማምጣት አልተቻለም",
      needsManualReview: true,
    };
  }

  // 2. Parse
  const data = parseReceiptHTML(fetch.html);
  if (!data.invoiceNo || !data.settledAmount) {
    return {
      ok: false,
      reason: "unparseable",
      message: "❌ የደረሰኝ ይዘት ማንበብ አልተቻለም",
      needsManualReview: true,
    };
  }

  // 3. Invoice matches?
  if (data.invoiceNo.toUpperCase() !== transactionId.toUpperCase()) {
    return {
      ok: false,
      reason: "invoice_mismatch",
      message: "❌ የደረሰኝ ቁጥር አይመሳሰልም",
    };
  }

  // 4. Status completed?
  if (!(data.status || "").toLowerCase().includes("complete")) {
    return {
      ok: false,
      reason: "not_completed",
      message: `❌ የግብይት ሁኔታ: ${data.status}`,
    };
  }

  // 5. Amount?
  if (expectedAmount && Math.abs(data.amount - expectedAmount) > 0.01) {
    return {
      ok: false,
      reason: "amount_mismatch",
      message: `❌ የደረሰኝ መጠን (${data.amount}) ከጠየቁት (${expectedAmount}) አይመሳሰልም`,
    };
  }

  // 6. Recipient phone?
  if (expectedRecipientPhone) {
    if (!phoneMatches(data.recipientPhone, expectedRecipientPhone)) {
      return {
        ok: false,
        reason: "wrong_recipient",
        message: `❌ ገንዘቡ ወደ ተሳሳተ ስልክ ተልኳል (${data.recipientPhone})`,
      };
    }
  }

  // 7. Sender phone (if provided)?
  if (expectedSenderPhone && data.payerPhone) {
    if (!phoneMatches(data.payerPhone, expectedSenderPhone)) {
      return {
        ok: false,
        reason: "wrong_sender",
        message: `❌ ደረሰኙ ከሌላ ስልክ ተልኳል (${data.payerPhone})`,
      };
    }
  }

  // 8. Age?
  if (data.paymentDateMs) {
    const ageHours = (Date.now() - data.paymentDateMs) / (1000 * 60 * 60);
    if (ageHours > maxAgeHours) {
      return {
        ok: false,
        reason: "stale",
        message: `❌ ደረሰኙ ከ ${maxAgeHours} ሰዓት በላይ አሮጌ ነው`,
      };
    }
  }

  return {
    ok: true,
    via: fetch.via,
    data,
  };
}

module.exports = {
  verifyTelebirrReceipt,
  fetchReceiptHTML,
  parseReceiptHTML,
  phoneMatches,
};