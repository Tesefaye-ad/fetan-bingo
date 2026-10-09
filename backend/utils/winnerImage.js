// ═══════════════════════════════════════════════════════
// WINNER IMAGE — ለ Telegram ግሩፕ (Play 50 / Play 100)
// ═══════════════════════════════════════════════════════
// የ BINGO ማሸነፊያ ስክሪንን ምስል አድርጎ (PNG) ወደ ግሩፕ ይልካል
// ═══════════════════════════════════════════════════════
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

/** ላቲን ያልሆኑ ፊደላትን ያስወግዳል (አማርኛ ስም ሲሆን fallback ይሆናል) */
function latinSafe(text, fallback = "Player") {
  const cleaned = String(text || "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 22);
  return cleaned || fallback;
}

// ═══════════════════════════════════════════════════════
// አንድ ካርቴላ መሳል
// ═══════════════════════════════════════════════════════
function drawCard(x, y, size, wc) {
  const cell = size / 5;
  const win = new Set(
    getWinningCells(wc.pattern).map(([r, c]) => `${r}-${c}`)
  );
  const headers = ["B", "I", "N", "G", "O"];
  const headerColors = ["#4c6ef5", "#9c27b0", "#e91e63", "#4caf50", "#ff9800"];

  let out = "";

  // Card number label
  out += `<text x="${x + size / 2}" y="${y - 12}" text-anchor="middle" font-size="20" font-weight="bold" fill="#f39c12" font-family="${FONT}">CARD #${wc.cardId}</text>`;

  // B I N G O headers
  const headerH = cell * 0.55;
  for (let c = 0; c < 5; c++) {
    const hx = x + c * cell;
    out += `<rect x="${hx + 3}" y="${y}" width="${cell - 6}" height="${headerH}" rx="8" fill="${headerColors[c]}"/>`;
    out += `<text x="${hx + cell / 2}" y="${y + headerH * 0.72}" text-anchor="middle" font-size="24" font-weight="bold" fill="#fff" font-family="${FONT}">${headers[c]}</text>`;
  }

  // 5x5 grid
  const gridY = y + headerH + 5;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const free = r === 2 && c === 2;
      const isWin = win.has(`${r}-${c}`);
      const marked = free || wc.marked?.[r]?.[c];

      const cx = x + c * cell;
      const cy = gridY + r * cell;

      let fill;
      if (free) fill = "#f39c12";          // ★ FREE — ذهبي
      else if (isWin) fill = "#4caf50";    // Winning line — አረንጓዴ
      else if (marked) fill = "#2ecc71";   // Called — አረንጓዴ ቀላል
      else fill = "#252d44";                // Not called — ጥቁር

      const stroke = isWin ? "#2ecc71" : "#2a2a40";
      const strokeWidth = isWin ? 3 : 1;

      out += `<rect x="${cx + 3}" y="${cy + 3}" width="${cell - 6}" height="${cell - 6}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;

      const textFill = free ? "#1b2233" : "#fff";
      const textValue = free ? "★" : wc.card[r][c];
      const fontSize = free ? 32 : 28;

      out += `<text x="${cx + cell / 2}" y="${cy + cell / 2 + fontSize * 0.35}" text-anchor="middle" font-size="${fontSize}" font-weight="bold" fill="${textFill}" font-family="${FONT}">${textValue}</text>`;
    }
  }

  return out;
}

// ═══════════════════════════════════════════════════════
// ሙሉ ስክሪን SVG
// ═══════════════════════════════════════════════════════
function buildWinnerSvg(d) {
  const W = 720;
  const pad = 30;
  const contentW = W - pad * 2;

  // ─── Layout ───
  const headerH = 240;
  const winnersCount = Math.min(d.winners.length, 5);
  const winnersBoxH = 60 + winnersCount * 54;
  const cardSize = 340;
  const cardsPerRow = Math.min(2, d.cartelas.length);
  const shownCards = Math.min(d.cartelas.length, 4);
  const cardRows = Math.ceil(shownCards / cardsPerRow);
  const cardsBoxH = 80 + cardRows * (cardSize + 50);
  const poolH = 90;
  const footerH = 70;

  const winnersStartY = headerH + 10;
  const cardsStartY = winnersStartY + winnersBoxH + 20;
  const poolStartY = cardsStartY + cardsBoxH + 20;

  const H = poolStartY + poolH + footerH;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;

  // ─── Defs ───
  svg += `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f1420"/>
      <stop offset="1" stop-color="#1a0f2e"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f39c12"/>
      <stop offset="0.5" stop-color="#ffd43b"/>
      <stop offset="1" stop-color="#f39c12"/>
    </linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2ecc71"/>
      <stop offset="1" stop-color="#27ae60"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="#f39c12" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#f39c12" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

  // ─── Background ───
  svg += `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;

  // ─── Confetti dots ───
  const dots = [
    [70, 50, 8, "#9c27b0"], [150, 30, 5, "#f39c12"], [560, 40, 6, "#4caf50"],
    [640, 80, 8, "#3498db"], [680, 30, 5, "#e74c3c"], [30, 180, 6, "#f39c12"],
    [690, 220, 5, "#2ecc71"], [80, 400, 6, "#3498db"], [650, 450, 5, "#9c27b0"],
    [40, 550, 7, "#f39c12"], [680, 600, 6, "#e74c3c"], [50, 700, 5, "#4caf50"],
    [660, 750, 6, "#f39c12"], [90, 800, 5, "#3498db"],
  ];
  for (const [dx, dy, dr, dc] of dots) {
    svg += `<circle cx="${dx}" cy="${dy}" r="${dr}" fill="${dc}" opacity="0.45"/>`;
  }

  // ═══════════════════════════════════════════════════
  // HEADER — BINGO!
  // ═══════════════════════════════════════════════════
  const hCenterY = 110;

  // Crown glow
  svg += `<circle cx="${W / 2 - 160}" cy="${hCenterY}" r="75" fill="url(#glow)"/>`;

  // Crown circle
  const cX = W / 2 - 160;
  const cY = hCenterY;
  svg += `<circle cx="${cX}" cy="${cY}" r="50" fill="#f39c12"/>`;
  svg += `<circle cx="${cX}" cy="${cY}" r="50" fill="none" stroke="#ffd43b" stroke-width="3"/>`;

  // Crown shape
  svg += `<path d="M ${cX - 24} ${cY + 14} L ${cX - 26} ${cY - 12} L ${cX - 12} ${cY - 2} L ${cX} ${cY - 20} L ${cX + 12} ${cY - 2} L ${cX + 26} ${cY - 12} L ${cX + 24} ${cY + 14} Z" fill="#1b2233"/>`;
  svg += `<circle cx="${cX - 12}" cy="${cY - 5}" r="3" fill="#f39c12"/>`;
  svg += `<circle cx="${cX}" cy="${cY - 8}" r="3" fill="#e74c3c"/>`;
  svg += `<circle cx="${cX + 12}" cy="${cY - 5}" r="3" fill="#3498db"/>`;
  svg += `<rect x="${cX - 24}" y="${cY + 14}" width="48" height="4" rx="2" fill="#1b2233"/>`;

  // BINGO! text
  svg += `<text x="${W / 2 + 60}" y="${hCenterY + 22}" text-anchor="middle" font-size="80" font-weight="bold" fill="url(#gold)" font-family="${FONT}">BINGO!</text>`;

  // Winner count
  const winnerText = `${d.winners.length} winner${d.winners.length > 1 ? "s" : ""}!`;
  svg += `<text x="${W / 2}" y="${hCenterY + 70}" text-anchor="middle" font-size="24" fill="#fff" font-family="${FONT}">${esc(winnerText)}</text>`;

  // Pattern badge
  const badgeY = hCenterY + 100;
  const badgeText = PATTERN_LABELS[d.winPattern] || String(d.winPattern).toUpperCase();
  const badgeW = 240;
  svg += `<rect x="${W / 2 - badgeW / 2}" y="${badgeY}" width="${badgeW}" height="50" rx="25" fill="#0f1420" stroke="#f39c12" stroke-width="2.5"/>`;
  svg += `<text x="${W / 2}" y="${badgeY + 32}" text-anchor="middle" font-size="20" font-weight="bold" fill="#f39c12" font-family="${FONT}">${esc(badgeText)}</text>`;

  // ═══════════════════════════════════════════════════
  // WINNERS BOX
  // ═══════════════════════════════════════════════════
  svg += `<rect x="${pad}" y="${winnersStartY}" width="${contentW}" height="${winnersBoxH}" rx="20" fill="#0a0a14" stroke="#f39c12" stroke-width="3"/>`;

  svg += `<text x="${W / 2}" y="${winnersStartY + 42}" text-anchor="middle" font-size="22" font-weight="bold" fill="#f39c12" font-family="${FONT}">WINNERS</text>`;

  // Winner rows
  let rowY = winnersStartY + 60;
  for (let i = 0; i < winnersCount; i++) {
    const w = d.winners[i];
    const rowH = 46;
    const rowPad = 20;

    svg += `<rect x="${pad + rowPad}" y="${rowY}" width="${contentW - rowPad * 2}" height="${rowH}" rx="10" fill="#0f1420" stroke="#2a2a40" stroke-width="1"/>`;

    // Name
    const nameText = latinSafe(w.name, "Player");
    svg += `<text x="${pad + rowPad + 20}" y="${rowY + 28}" font-size="18" font-weight="bold" fill="#fff" font-family="${FONT}">${esc(nameText)}</text>`;

    // Cartela numbers
    const cardsText = w.cartelas.map((c) => `#${c}`).join(", ");
    svg += `<text x="${pad + rowPad + 20}" y="${rowY + 42}" font-size="11" fill="#888" font-family="${FONT}">Cartela ${esc(cardsText)}</text>`;

    // Prize badge
    const prizeW = 130;
    const prizeX = W - pad - rowPad - 20 - prizeW;
    svg += `<rect x="${prizeX}" y="${rowY + 8}" width="${prizeW}" height="${rowH - 16}" rx="15" fill="#0f1420" stroke="#2ecc71" stroke-width="2"/>`;
    svg += `<text x="${prizeX + prizeW / 2}" y="${rowY + rowH / 2 + 6}" text-anchor="middle" font-size="16" font-weight="bold" fill="#2ecc71" font-family="${FONT}">+${esc(w.prize)} ETB</text>`;

    rowY += rowH + 8;
  }

  // ═══════════════════════════════════════════════════
  // WINNING CARTELAS BOX
  // ═══════════════════════════════════════════════════
  svg += `<rect x="${pad}" y="${cardsStartY}" width="${contentW}" height="${cardsBoxH}" rx="20" fill="#0a0a14" stroke="#2ecc71" stroke-width="3"/>`;

  svg += `<text x="${W / 2}" y="${cardsStartY + 42}" text-anchor="middle" font-size="22" font-weight="bold" fill="#2ecc71" font-family="${FONT}">WINNING CARTELAS (${d.cartelas.length})</text>`;

  // Draw each card
  const shown = d.cartelas.slice(0, 4);
  const cardGapX = 20;
  const totalW = cardsPerRow * cardSize + (cardsPerRow - 1) * cardGapX;
  const startX = (W - totalW) / 2;
  const cardsContentStartY = cardsStartY + 70;

  shown.forEach((wc, i) => {
    const col = i % cardsPerRow;
    const row = Math.floor(i / cardsPerRow);
    const cx = startX + col * (cardSize + cardGapX);
    const cy = cardsContentStartY + row * (cardSize + 50);

    // Owner header
    svg += `<rect x="${cx}" y="${cy - 45}" width="${cardSize}" height="38" rx="8" fill="#1a1a2e" stroke="#f39c12" stroke-width="1.5"/>`;
    const nameText = latinSafe(wc.name, "Player");
    svg += `<text x="${cx + 15}" y="${cy - 22}" font-size="15" font-weight="bold" fill="#fff" font-family="${FONT}">${esc(nameText)}</text>`;
    svg += `<text x="${cx + cardSize - 15}" y="${cy - 22}" text-anchor="end" font-size="15" font-weight="bold" fill="#f39c12" font-family="${FONT}">CARD #${wc.cardId}</text>`;

    // Draw bingo card
    svg += drawCard(cx, cy, cardSize, wc);
  });

  // ═══════════════════════════════════════════════════
  // POOL BADGE
  // ═══════════════════════════════════════════════════
  const poolW = 320;
  const poolX = (W - poolW) / 2;
  svg += `<rect x="${poolX}" y="${poolStartY}" width="${poolW}" height="60" rx="30" fill="url(#green)"/>`;
  svg += `<text x="${W / 2}" y="${poolStartY + 39}" text-anchor="middle" font-size="26" font-weight="bold" fill="#fff" font-family="${FONT}">Pool: ${esc(d.prizePool)} ETB</text>`;

  // ═══════════════════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════════════════
  const footerY = poolStartY + poolH;
  svg += `<text x="${W / 2}" y="${footerY + 25}" text-anchor="middle" font-size="14" fill="#888" font-family="${FONT}">${esc(d.dateText || "")}</text>`;
  svg += `<text x="${W / 2}" y="${footerY + 48}" text-anchor="middle" font-size="12" fill="#666" font-family="${FONT}">Fetan Bingo - ${esc(d.roomCode)}</text>`;

  svg += `</svg>`;
  return svg;
}

async function buildWinnerPng(data) {
  const sharp = require("sharp");
  return sharp(Buffer.from(buildWinnerSvg(data))).png().toBuffer();
}

module.exports = { buildWinnerSvg, buildWinnerPng, latinSafe };