"use strict";
// ═══════════════════════════════════════════════════════
// ክፍል 2: ONLINE RECEIPT VERIFIER
// ═══════════════════════════════════════════════════════
const axios = require("axios");
const cheerio = require("cheerio");

const RECEIPT_HOST = "transactioninfo.ethiotelecom.et";
const RECEIPT_BASE = `https://${RECEIPT_HOST}/receipt/`;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 1024 * 1024;
const MIN_HTML_LEN = 500;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,am;q=0.8",
  "Cache-Control": "no-cache",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── URL ግንባታ (SSRF መከላከያ) ───
function buildReceiptUrl(txnId) {
  if (!/^[A-Za-z0-9]{6,20}$/.test(String(txnId || ""))) return null;
  return RECEIPT_BASE + String(txnId).toUpperCase();
}

// ─── ደረሰኙን ማምጣት ───
async function fetchDirect(url, retries = 2) {
  let last = { ok: false, via: "direct", error: "unknown" };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers: HEADERS,
        responseType: "text",
        maxRedirects: 3,
        maxContentLength: MAX_BYTES,
        beforeRedirect: (opts) => {
          if (String(opts.hostname || "").toLowerCase() !== RECEIPT_HOST) {
            throw new Error("redirect_blocked");
          }
        },
        validateStatus: (s) => s >= 200 && s < 500,
      });

      if (res.status === 404) {
        return { ok: false, via: "direct", notFound: true };
      }

      if (
        res.status === 200 &&
        typeof res.data === "string" &&
        res.data.length > MIN_HTML_LEN
      ) {
        return { ok: true, html: res.data, via: "direct" };
      }

      last = { ok: false, via: "direct", status: res.status };
      if (res.status >= 400) break;
    } catch (err) {
      last = { ok: false, via: "direct", error: err.message };
    }

    if (attempt < retries) await sleep(500 * (attempt + 1));
  }

  return last;
}

async function fetchReceiptHtml(txnId) {
  const url = buildReceiptUrl(txnId);
  if (!url) return { ok: false, error: "invalid_id" };

  const direct = await fetchDirect(url);
  if (direct.ok || direct.notFound) return direct;

  // አማራጭ proxy
  if (String(process.env.RECEIPT_PROXY_FALLBACK).toLowerCase() === "true") {
    const proxies = [
      {
        name: "allorigins",
        url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        pick: (d) => d && d.contents,
      },
      {
        name: "corsproxy",
        url: `https://corsproxy.io/?${encodeURIComponent(url)}`,
        pick: (d) => d,
      },
    ];

    for (const p of proxies) {
      try {
        const res = await axios.get(p.url, {
          timeout: TIMEOUT_MS,
          headers: HEADERS,
          maxContentLength: MAX_BYTES,
        });
        const html = p.pick(res.data);
        if (typeof html === "string" && html.length > MIN_HTML_LEN) {
          return { ok: true, html, via: p.name };
        }
      } catch {}
    }
  }

  console.error(
    `[receipt] ❌ ${txnId} fetch failed:`,
    direct.error || direct.status || "unknown"
  );
  return {
    ok: false,
    error: direct.error || `status_${direct.status || "unknown"}`,
  };
}

// ─── HTML መተንተን ───
function parseReceiptHtml(html) {
  const $ = cheerio.load(html);
  const cells = [];

  $("td").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t) cells.push(t);
  });

  const valueAfter = (...labels) => {
    for (let i = 0; i < cells.length - 1; i++) {
      const cell = cells[i].toLowerCase();
      if (labels.some((l) => cell.includes(l.toLowerCase()))) {
        const next = cells[i + 1];
        if (next) return next;
      }
    }
    return null;
  };

  const data = {
    payerName: valueAfter("Payer Name", "የከፋይ ስም"),
    payerPhone: valueAfter("Payer telebirr no", "የከፋይ ቴሌብር"),
    recipientName: valueAfter("Credited Party name", "ተቀባይ ስም"),
    recipientPhone: valueAfter(
      "Credited party account no",
      "የተቀባይ አካውንት"
    ),
    status: valueAfter("Transaction status", "የግብይት ሁኔታ"),
    invoiceNo: valueAfter("Invoice No", "ደረሰኝ ቁጥር"),
    paymentDate: valueAfter("Payment date", "የክፍያ ቀን"),
    settledAmount: valueAfter("Settled Amount", "የተከፈለ መጠን"),
    totalPaidAmount: valueAfter("Total Paid Amount", "ጠቅላላ የተከፈለ"),
    serviceFee: valueAfter("Service fee"),
  };

  // Amount parsing: "1,250.50 Birr" → 1250.5
  data.amount = null;
  if (data.settledAmount) {
    const m = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(
      data.settledAmount
    );
    if (m) {
      data.amount = Number(
        m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : "")
      );
    }
  }

  // Date parsing: "08-10-2026 08:31:50" → UTC+3
  data.paymentDateMs = null;
  if (data.paymentDate) {
    const m = /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(
      data.paymentDate
    );
    if (m) {
      const [, d, mo, y, h, mi, s] = m;
      const p = (n) => String(n).padStart(2, "0");
      const ms = new Date(
        `${y}-${p(mo)}-${p(d)}T${p(h)}:${mi}:${s}+03:00`
      ).getTime();
      if (!Number.isNaN(ms)) data.paymentDateMs = ms;
    }
  }

  return data;
}

// ─── Matchers ───
function normalizePhone(p) {
  let n = String(p || "").replace(/[^\d*]/g, "");
  if (n.startsWith("0")) n = "251" + n.slice(1);
  else if (/^9\d{8}$/.test(n)) n = "251" + n;
  return n;
}

function phoneMatches(receiptPhone, expectedPhone) {
  if (!receiptPhone || !expectedPhone) return false;
  const a = normalizePhone(receiptPhone);
  const b = normalizePhone(expectedPhone);
  if (!a || !b) return false;

  if (a.includes("*")) {
    const parts = a.split(/\*+/);
    if (parts.length !== 2) return false;
    return (
      b.length === a.length &&
      b.startsWith(parts[0]) &&
      b.endsWith(parts[1])
    );
  }
  return a === b;
}

function nameMatches(receiptName, expectedName) {
  if (!receiptName || !expectedName) return false;
  const tok = (s) =>
    String(s)
      .toLowerCase()
      .split(/[^\p{L}\p{N}*]+/u)
      .filter(Boolean);

  const have = tok(receiptName);
  return tok(expectedName).every((want) =>
    have.some((h) => {
      if (!h.includes("*")) return h === want;
      const prefix = h.slice(0, h.indexOf("*"));
      const suffix = h.slice(h.lastIndexOf("*") + 1);
      return (
        prefix.length >= 1 && want.startsWith(prefix) && want.endsWith(suffix)
      );
    })
  );
}

const cents = (n) => Math.round(Number(n) * 100);

// ═══════════════════════════════════════════════════════
// ሙሉ ማረጋገጫ
// ═══════════════════════════════════════════════════════
async function verifyReceipt(options) {
  const { txnId, expectedAmount, smsTimestampMs, merchant, payerPhone } =
    options;
  const maxAgeHours = options.maxAgeHours || 24;
  const now = options.now || Date.now();

  const fail = (reason, message, extra) => ({
    ok: false,
    reason,
    message,
    ...extra,
  });

  if (!buildReceiptUrl(txnId)) {
    return fail("invalid_id", "የግብይት ቁጥሩ ቅርጸት ትክክል አይደለም");
  }

  const fetched = await fetchReceiptHtml(txnId);
  if (fetched.notFound) {
    return fail(
      "receipt_not_found",
      "ይህ ደረሰኝ በኢትዮ ቴሌኮም ላይ አልተገኘም (ሃሰተኛ ሊንክ/ቁጥር)"
    );
  }
  if (!fetched.ok) {
    return fail("fetch_failed", "ደረሰኙን ማምጣት አልተቻለም", {
      manualReview: true,
    });
  }

  const data = parseReceiptHtml(fetched.html);
  if (!data.invoiceNo || data.amount == null) {
    return fail("unparseable", "የደረሰኝ ይዘት ማንበብ አልተቻለም", {
      manualReview: true,
    });
  }

  if (data.invoiceNo.trim().toUpperCase() !== String(txnId).toUpperCase()) {
    return fail("invoice_mismatch", "የደረሰኝ ቁጥር ከ SMS ጋር አይመሳሰልም");
  }
  if (!/complete|success/i.test(data.status || "")) {
    return fail(
      "not_completed",
      `የግብይት ሁኔታ ያልተጠናቀቀ ነው (${data.status || "ያልታወቀ"})`
    );
  }
  if (cents(data.amount) !== cents(expectedAmount)) {
    return fail(
      "amount_mismatch",
      `የደረሰኝ መጠን (${data.amount}) ከተጠየቀው (${expectedAmount}) ጋር አይመሳሰልም`
    );
  }
  if (!phoneMatches(data.recipientPhone, merchant.phone)) {
    return fail("wrong_recipient", "ገንዘቡ ወደ እኛ አካውንት አልገባም");
  }
  if (merchant.name && !nameMatches(data.recipientName, merchant.name)) {
    return fail(
      "wrong_recipient_name",
      "የተቀባይ ስም ከእኛ መርቻንት ስም ጋር አይመሳሰልም"
    );
  }
  if (payerPhone && !phoneMatches(data.payerPhone, payerPhone)) {
    return fail("wrong_sender", "ክፍያው ከተመዘገበው ስልክ አልተላከም");
  }

  if (!data.paymentDateMs) {
    return fail("unparseable", "የክፍያ ቀን ማንበብ አልተቻለም", {
      manualReview: true,
    });
  }
  if (data.paymentDateMs > now + 5 * 60 * 1000) {
    return fail("future_dated", "የክፍያ ቀኑ ትክክል አይደለም");
  }
  if ((now - data.paymentDateMs) / 3600000 > maxAgeHours) {
    return fail("stale", `ደረሰኙ ከ ${maxAgeHours} ሰዓት በላይ አሮጌ ነው`);
  }
  if (
    smsTimestampMs &&
    Math.abs(smsTimestampMs - data.paymentDateMs) > 10 * 60 * 1000
  ) {
    return fail(
      "time_mismatch",
      "የ SMS ሰዓት ከደረሰኙ ሰዓት ጋር አይመሳሰልም"
    );
  }

  return { ok: true, via: fetched.via, data };
}

module.exports = {
  verifyReceipt,
  fetchReceiptHtml,
  parseReceiptHtml,
  buildReceiptUrl,
  phoneMatches,
  nameMatches,
};