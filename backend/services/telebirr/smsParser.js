"use strict";
// ═══════════════════════════════════════════════════════
// ክፍል 1: TELEBIRR SMS PARSER
// ከ SMS ጽሑፍ ውስጥ የሚከተሉትን ያወጣል:
//   • Transaction ID    (DJ85JP3L6V)
//   • Amount            (100.00)
//   • Timestamp         (08/10/2026 08:31:50 → UTC+3)
//   • Receipt URL       (transactioninfo.ethiotelecom.et/receipt/...)
//   • Direction         (sent | received)
//   • SHA-256 fingerprint
// ═══════════════════════════════════════════════════════
const crypto = require("crypto");

const RECEIPT_HOST = "transactioninfo.ethiotelecom.et";
const RECEIPT_PATH_RE = /^\/receipt\/([A-Za-z0-9]{6,20})\/?$/;

// ─── 0) ጽሑፍ ማጽዳት ───
function normalizeSms(text) {
  return String(text ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars
    .replace(/\u00A0/g, " ")                // NBSP → space
    .replace(/\s+/g, " ")                   // multiple spaces → one
    .trim();
}

// ─── 1) Amount ───
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;

const VERB_AMOUNT_RE = new RegExp(
  String.raw`(?:received|transferred|transfered|sent|paid|credited)\s+(?:ETB|Birr|ብር)?\s*${NUM}`,
  "i"
);
const CUR_BEFORE_RE = new RegExp(String.raw`(?:ETB|Birr|ብር)\s*${NUM}`, "gi");
const CUR_AFTER_RE = new RegExp(String.raw`${NUM}\s*(?:ETB|Birr|ብር)`, "gi");

// "balance", "fee", "VAT" የመሳሰሉት የዝውውር መጠን አይደሉም
const NOT_TRANSFER_CTX =
  /balance|fee|charge|vat|tax|commission|ቀሪ|ሂሳብ|ክፍያ|ኮሚሽን|ታክስ/i;

function toAmount(intPart, decPart) {
  const n = Number(intPart.replace(/,/g, "") + (decPart ? "." + decPart : ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function extractAmount(raw) {
  // ቅድሚያ 1: "transferred ETB X" / "paid X ETB"
  const verb = VERB_AMOUNT_RE.exec(raw);
  if (verb) {
    const a = toAmount(verb[1], verb[2]);
    if (a) return a;
  }
  // ቅድሚያ 2: "ETB X" / "X ETB" — context ፈትሽ
  const candidates = [];
  for (const re of [CUR_BEFORE_RE, CUR_AFTER_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const ctx = raw.slice(Math.max(0, m.index - 25), m.index);
      if (NOT_TRANSFER_CTX.test(ctx)) continue;
      const a = toAmount(m[1], m[2]);
      if (a) candidates.push({ index: m.index, amount: a });
    }
  }
  candidates.sort((x, y) => x.index - y.index);
  return candidates.length ? candidates[0].amount : null;
}

// ─── 2) Transaction ID ───
const TXN_LABEL_RE =
  /(?:transaction\s*(?:number|no\.?|id)|የግብይት\s*(?:ቁጥር|መለያ)|ግብይት\s*ቁጥር)\s*(?:is|:|፡|-)?\s*([A-Za-z0-9]{8,14})\b/i;

function looksLikeTxnId(s) {
  return (
    /^[A-Za-z0-9]{8,14}$/.test(s) &&
    /\d/.test(s) &&
    /[A-Za-z]/.test(s)
  );
}

// ─── 3) Timestamp ───
const TS_RE = /(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/;

function extractTimestamp(raw) {
  const m = TS_RE.exec(raw);
  if (!m) return null;

  const [, d, mo, y, h, mi, s] = m;
  const day = Number(d);
  const month = Number(mo);
  const year = Number(y);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  // የቀን ማረጋገጫ (31/02 → ውድቅ)
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCDate() !== day || probe.getUTCMonth() !== month - 1) {
    return null;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`;
  const ms = new Date(iso).getTime();

  return Number.isNaN(ms) ? null : { raw: m[0], iso, ms };
}

// ─── 4) Receipt URL ───
function extractUrls(raw) {
  const out = [];
  const re = /https?:\/\/[^\s<>()\[\]"'`]+/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    out.push(m[0].replace(/[.,;:!?]+$/, ""));
  }
  return out;
}

function extractReceiptUrl(raw) {
  let receiptUrl = null;
  let receiptId = null;
  let fakeLink = false;

  for (const candidate of extractUrls(raw)) {
    let u;
    try {
      u = new URL(candidate);
    } catch {
      continue;
    }

    const pm = RECEIPT_PATH_RE.exec(u.pathname);
    const isRealHost =
      u.hostname.toLowerCase() === RECEIPT_HOST && u.protocol === "https:";

    if (isRealHost && pm) {
      if (!receiptUrl) {
        receiptId = pm[1].toUpperCase();
        receiptUrl = `https://${RECEIPT_HOST}/receipt/${receiptId}`;
      }
    } else if (/\/receipt\//i.test(u.pathname)) {
      fakeLink = true;
    }
  }

  return { receiptUrl, receiptId, fakeLink };
}

// ─── 5) Direction ───
function detectDirection(raw) {
  if (
    /\b(?:transferred|transfered|paid|sent)\b|ልከዋል|ከፍለዋል|አስተላልፈዋል/i.test(
      raw
    )
  ) {
    return "sent";
  }
  if (/\breceived\b|ተቀብለዋል/i.test(raw)) return "received";
  return "unknown";
}

// ═══════════════════════════════════════════════════════
// ዋና ተግባር
// ═══════════════════════════════════════════════════════
function parseTelebirrSms(text) {
  const raw = normalizeSms(text);
  const errors = [];

  const { receiptUrl, receiptId, fakeLink } = extractReceiptUrl(raw);
  if (fakeLink) errors.push("fake_receipt_link");

  let labelId = null;
  const idMatch = TXN_LABEL_RE.exec(raw);
  if (idMatch && looksLikeTxnId(idMatch[1])) {
    labelId = idMatch[1].toUpperCase();
  }

  if (labelId && receiptId && labelId !== receiptId) {
    errors.push("txn_id_conflict");
  }

  const txnId = labelId || receiptId || null;
  if (!txnId) errors.push("txn_id_missing");

  const amount = extractAmount(raw);
  if (!amount) errors.push("amount_missing");

  const timestamp = extractTimestamp(raw);

  return {
    ok: errors.length === 0,
    errors,
    raw,
    txnId,
    amount,
    timestamp,
    receiptUrl,
    direction: detectDirection(raw),
    fingerprint: crypto
      .createHash("sha256")
      .update(raw.toLowerCase())
      .digest("hex"),
  };
}

module.exports = {
  parseTelebirrSms,
  normalizeSms,
  extractReceiptUrl,
  extractAmount,
  extractTimestamp,
  RECEIPT_HOST,
};