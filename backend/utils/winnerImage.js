// ═══════════════════════════════════════════════════════
// WINNER IMAGE — የአሸናፊዎች ፓናል ምስል (PNG) ለ Telegram ግሩፕ
// ═══════════════════════════════════════════════════════
// ሰርቨሩ ራሱ ፓናሉን በ SVG ይሳልና ወደ PNG ይቀይረዋል (sharp). በዚህ መንገድ:
//  • ምስሉ በትክክል አንድ ጊዜ ብቻ ይላካል (ብዙ ተጫዋቾች ቢኖሩም አይደገምም)
//  • ማንም ተጫዋች ኦንላይን ባይሆንም ይሰራል
// ማሳሰቢያ: በሰርቨሩ ላይ የአማርኛ ፎንት (Noto Sans Ethiopic) ላይኖር ስለሚችል በምስሉ ውስጥ
// የላቲን ፊደላት ብቻ ይጻፋሉ. አማርኛ ዝርዝሩ በ Telegram መልዕክት (caption) ውስጥ ይላካል.
const { getWinningCells } = require("./bingoCard");

const FONT = "DejaVu Sans, Arial, Helvetica, sans-serif";
const PATTERN_LABELS = {
  "any-row": "ANY ROW",
  "any-column": "ANY COLUMN",
  "any-diagonal": "DIAGONAL",
  "four-corners": "4 CORNERS",
  "full-card": "FULL CARD",
};

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** ላቲን ያልሆኑ ፊደላትን ያስወግዳል (ፎንት የሌለው ሰርቨር "□" እንዳያሳይ) */
function latinSafe(text, fallback = "Player") {
  const cleaned = String(text || "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 22);
  return cleaned || fallback;
}

function cardSvg(wc, x, y, size) {
  const cell = size / 5;
  const win = new Set(getWinningCells(wc.pattern).map(([r, c]) => `${r}-${c}`));
  const headers = ["B", "I", "N", "G", "O"];
  let out = `<text x="${x + size / 2}" y="${y - 8}" text-anchor="middle" font-size="15" font-weight="bold" fill="#f39c12" font-family="${FONT}">CARD #${esc(
    wc.cardId
  )}</text>`;
  for (let c = 0; c < 5; c++) {
    out += `<rect x="${x + c * cell}" y="${y}" width="${cell - 2}" height="${
      cell * 0.6
    }" rx="4" fill="#4c6ef5"/><text x="${x + c * cell + (cell - 2) / 2}" y="${
      y + cell * 0.42
    }" text-anchor="middle" font-size="14" font-weight="bold" fill="#fff" font-family="${FONT}">${
      headers[c]
    }</text>`;
  }
  const top = y + cell * 0.6 + 3;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const free = r === 2 && c === 2;
      const isWin = win.has(`${r}-${c}`);
      const marked = free || wc.marked?.[r]?.[c];
      const fill = isWin ? "#2ecc71" : marked ? "#e67e22" : "#1b2233";
      const cx = x + c * cell;
      const cy = top + r * cell;
      out += `<rect x="${cx}" y="${cy}" width="${cell - 2}" height="${
        cell - 2
      }" rx="5" fill="${fill}" stroke="${isWin ? "#fff" : "#2a2a40"}" stroke-width="${
        isWin ? 2 : 1
      }"/><text x="${cx + (cell - 2) / 2}" y="${
        cy + (cell - 2) / 2 + 6
      }" text-anchor="middle" font-size="${
        free ? 13 : 16
      }" font-weight="bold" fill="#fff" font-family="${FONT}">${
        free ? "FREE" : esc(wc.card[r][c])
      }</text>`;
    }
  }
  return out;
}

/**
 * @param {object} d { roomCode, entryFee, prizePool, winPattern, dateText,
 *                     winners:[{name,cartelas:[id],prize}], cartelas:[{cardId,card,marked,pattern}] }
 * @returns {string} SVG
 */
function buildWinnerSvg(d) {
  const W = 720;
  const cardSize = 200;
  const perRow = 3;
  const shown = d.cartelas.slice(0, 6);
  const winners = d.winners.slice(0, 8);
  const headerH = 150;
  const winnersH = 34 + winners.length * 30;
  const cardsRows = Math.ceil(shown.length / perRow);
  const cardRowH = cardSize + 60;
  const H = headerH + winnersH + cardsRows * cardRowH + 50;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1420"/><stop offset="1" stop-color="#1a0f2e"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="18" fill="none" stroke="#f39c12" stroke-width="3"/>
<text x="${W / 2}" y="62" text-anchor="middle" font-size="40" font-weight="bold" fill="#f39c12" font-family="${FONT}">BINGO! WINNERS</text>
<text x="${W / 2}" y="94" text-anchor="middle" font-size="18" fill="#aaa" font-family="${FONT}">Fetan Bingo - ${esc(d.roomCode)} - Stake ${esc(d.entryFee)} ETB</text>
<text x="${W / 2}" y="124" text-anchor="middle" font-size="22" font-weight="bold" fill="#2ecc71" font-family="${FONT}">Prize pool: ${esc(d.prizePool)} ETB  |  ${esc(PATTERN_LABELS[d.winPattern] || d.winPattern)}</text>`;

  let y = headerH + 10;
  svg += `<text x="40" y="${y}" font-size="18" font-weight="bold" fill="#f39c12" font-family="${FONT}">WINNERS</text>`;
  y += 28;
  for (const w of winners) {
    const cartelas = (w.cartelas || []).map((c) => `#${c}`).join(", ");
    svg += `<text x="40" y="${y}" font-size="18" fill="#fff" font-family="${FONT}">${esc(
      latinSafe(w.name)
    )}  -  card ${esc(cartelas)}</text><text x="${W - 40}" y="${y}" text-anchor="end" font-size="18" font-weight="bold" fill="#2ecc71" font-family="${FONT}">${esc(
      w.prize
    )} ETB</text>`;
    y += 30;
  }

  const gridW = perRow * cardSize + (perRow - 1) * 20;
  const startX = (W - gridW) / 2;
  let cy = headerH + winnersH + 40;
  shown.forEach((wc, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    svg += cardSvg(
      wc,
      startX + col * (cardSize + 20),
      cy + row * cardRowH,
      cardSize
    );
  });

  svg += `<text x="${W / 2}" y="${H - 24}" text-anchor="middle" font-size="14" fill="#888" font-family="${FONT}">${esc(
    d.dateText || ""
  )}</text></svg>`;
  return svg;
}

async function buildWinnerPng(data) {
  const sharp = require("sharp"); // lazy — ካልተጫነ ጠሪው text fallback ይጠቀማል
  return sharp(Buffer.from(buildWinnerSvg(data))).png().toBuffer();
}

module.exports = { buildWinnerSvg, buildWinnerPng, latinSafe };
