// ═══════════════════════════════════════════════════════
// WINNER IMAGE — የአሸናፊ ካርቴላ ምስል ሰሪ (App UI Style)
// ═══════════════════════════════════════════════════════
const sharp = require("sharp");
const { getWinningCells } = require("./bingoCard");

const FONT = "DejaVu Sans, Arial, sans-serif";
const PATTERN_LABELS = {
  "any-row": "ANY ROW",
  "any-column": "ANY COLUMN",
  "any-diagonal": "ANY DIAGONAL",
  "four-corners": "4 CORNERS",
  "full-card": "FULL CARD",
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function latinSafe(text, fallback = "Player") {
  const cleaned = String(text || "").replace(/[^\x20-\x7E]/g, "").trim().slice(0, 22);
  return cleaned || fallback;
}

// ─── የካርቴላውን ሰንጠረዥ መሳል (5x5) ───
function drawCard(x, y, size, wc) {
  const cellSize = size / 5;
  const winCells = new Set(getWinningCells(wc.pattern).map(([r, c]) => `${r}-${c}`));
  let out = "";

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const isFree = r === 2 && c === 2;
      const isWin = winCells.has(`${r}-${c}`);
      const isMarked = isFree || wc.marked?.[r]?.[c];
      
      const cx = x + c * cellSize;
      const cy = y + r * cellSize;

      // 🎨 App ላይ እንዳለው የቀለም ጥምረት (Gradients)
      let fill = "url(#darkCell)"; // Unmarked
      let textColor = "#ffffff";
      
      if (isFree) {
        fill = "url(#goldCell)";
        textColor = "#1b2233";
      } else if (isWin || isMarked) {
        fill = isWin ? "url(#greenWinCell)" : "url(#greenCell)";
      }

      const border = isWin ? "3px solid #4caf50" : "1px solid #2a2a40";

      // ሳጥን
      out += `<rect x="${cx + 3}" y="${cy + 3}" width="${cellSize - 6}" height="${cellSize - 6}" rx="8" fill="${fill}" stroke="${border}" />`;
      
      // ጽሑፍ
      const textVal = isFree ? "★" : wc.card[r][c];
      const fontSize = isFree ? 32 : 26;
      out += `<text x="${cx + cellSize / 2}" y="${cy + cellSize / 2 + fontSize * 0.35}" text-anchor="middle" font-size="${fontSize}" font-weight="bold" fill="${textColor}" font-family="${FONT}">${textVal}</text>`;
    }
  }
  return out;
}

// ─── ሙሉ ስክሪን SVG ───
function buildWinnerSvg(d) {
  const W = 600;
  const H = 900;
  
  const cardSize = 420;
  const cardX = (W - cardSize) / 2;
  const cardY = 360;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;

  // Defs (Gradients)
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
    <linearGradient id="goldCell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd43b"/>
      <stop offset="1" stop-color="#f39c12"/>
    </linearGradient>
    <linearGradient id="greenWinCell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4caf50"/>
      <stop offset="1" stop-color="#2ecc71"/>
    </linearGradient>
    <linearGradient id="greenCell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#27ae60"/>
      <stop offset="1" stop-color="#2ecc71"/>
    </linearGradient>
    <linearGradient id="darkCell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#252d44"/>
      <stop offset="1" stop-color="#1b2233"/>
    </linearGradient>
  </defs>`;

  // Background
  svg += `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;

  // ─── Header (BINGO!) ───
  const hCenterY = 110;
  
  // Crown
  const cX = W / 2 - 120;
  const cY = hCenterY;
  svg += `<circle cx="${cX}" cy="${cY}" r="45" fill="#f39c12"/>`;
  svg += `<path d="M ${cX - 20} ${cY + 12} L ${cX - 22} ${cY - 10} L ${cX - 10} ${cY - 2} L ${cX} ${cY - 18} L ${cX + 10} ${cY - 2} L ${cX + 22} ${cY - 10} L ${cX + 20} ${cY + 12} Z" fill="#1b2233"/>`;
  
  // BINGO Text
  svg += `<text x="${W / 2 + 50}" y="${hCenterY + 20}" text-anchor="middle" font-size="70" font-weight="900" fill="url(#gold)" font-family="${FONT}">BINGO!</text>`;
  
  // Winner count
  const winnerText = `🎉 ${d.winners.length} Winner${d.winners.length > 1 ? "s" : ""}!`;
  svg += `<text x="${W / 2}" y="${hCenterY + 65}" text-anchor="middle" font-size="24" font-weight="bold" fill="#ffffff" font-family="${FONT}">${esc(winnerText)}</text>`;

  // Pattern Badge
  const badgeY = hCenterY + 90;
  const badgeText = PATTERN_LABELS[d.winPattern] || String(d.winPattern).toUpperCase();
  const badgeW = 220;
  svg += `<rect x="${W / 2 - badgeW / 2}" y="${badgeY}" width="${badgeW}" height="40" rx="20" fill="#0f1420" stroke="#f39c12" stroke-width="2"/>`;
  svg += `<text x="${W / 2}" y="${badgeY + 26}" text-anchor="middle" font-size="18" font-weight="bold" fill="#f39c12" font-family="${FONT}">⬜ ${esc(badgeText)}</text>`;

  // ─── Winners List ───
  const listY = badgeY + 70;
  const listH = 60 + (d.winners.length * 50);
  
  svg += `<rect x="40" y="${listY}" width="${W - 80}" height="${listH}" rx="16" fill="#0a0a14" stroke="#f39c12" stroke-width="2"/>`;
  svg += `<text x="${W / 2}" y="${listY + 30}" text-anchor="middle" font-size="18" font-weight="bold" fill="#f39c12" font-family="${FONT}">🏆 WINNERS</text>`;

  let rY = listY + 45;
  for (let i = 0; i < d.winners.length; i++) {
    const w = d.winners[i];
    const name = latinSafe(w.name, "Player");
    const cartelas = w.cartelas.map(c => `#${c}`).join(", ");

    svg += `<rect x="60" y="${rY}" width="${W - 120}" height="42" rx="8" fill="#0f1420" stroke="#2a2a40" stroke-width="1"/>`;
    
    // Name & Cartela
    svg += `<text x="80" y="${rY + 17}" font-size="14" font-weight="bold" fill="#fff" font-family="${FONT}">👤 ${esc(name)}</text>`;
    svg += `<text x="80" y="${rY + 33}" font-size="11" fill="#f39c12" font-family="${FONT}">🎴 Cartela: ${esc(cartelas)}</text>`;

    // Prize
    svg += `<rect x="${W - 200}" y="${rY + 9}" width="120" height="24" rx="12" fill="rgba(46, 204, 113, 0.2)" stroke="#2ecc71" stroke-width="1"/>`;
    svg += `<text x="${W - 140}" y="${rY + 26}" text-anchor="middle" font-size="13" font-weight="bold" fill="#2ecc71" font-family="${FONT}">+${w.prize} ETB</text>`;

    rY += 50;
  }

  // ─── Winning Cartela (የመጀመሪያው አሸናፊ ብቻ) ───
  const wc = d.cartelas[0];
  if (wc) {
    // B I N G O Headers
    const headerH = (cardSize / 5) * 0.55;
    const headers = ["B", "I", "N", "G", "O"];
    const headerColors = ["#4c6ef5", "#9c27b0", "#e91e63", "#4caf50", "#ff9800"];
    
    // የካርዱ ሳጥን
    svg += `<rect x="${cardX - 15}" y="${cardY - 15}" width="${cardSize + 30}" height="${cardSize + 30}" rx="16" fill="#0a0a14" stroke="#3498db" stroke-width="2"/>`;
    
    // ርዕስ
    svg += `<text x="${cardX}" y="${cardY - 30}" font-size="14" font-weight="bold" fill="#3498db" font-family="${FONT}">🎴 WINNING CARTELA</text>`;

    for (let c = 0; c < 5; c++) {
      const hx = cardX + c * (cardSize / 5);
      svg += `<rect x="${hx + 3}" y="${cardY}" width="${(cardSize / 5) - 6}" height="${headerH}" rx="6" fill="${headerColors[c]}"/>`;
      svg += `<text x="${hx + (cardSize / 10)}" y="${cardY + headerH * 0.7}" text-anchor="middle" font-size="20" font-weight="bold" fill="#fff" font-family="${FONT}">${headers[c]}</text>`;
    }

    // ዋናው ግሪድ (ከ B I N G O ራስጌ በታች)
    svg += drawCard(cardX, cardY + headerH + 5, cardSize, wc);
  }

  svg += `</svg>`;
  return svg;
}

async function buildWinnerPng(data) {
  return sharp(Buffer.from(buildWinnerSvg(data))).png().toBuffer();
}

module.exports = { buildWinnerSvg, buildWinnerPng, latinSafe };