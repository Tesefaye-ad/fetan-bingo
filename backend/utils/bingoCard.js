function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function range(start, end) {
  const out = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function generate75BallCard() {
  const cols = [
    shuffle(range(1, 15)).slice(0, 5),
    shuffle(range(16, 30)).slice(0, 5),
    shuffle(range(31, 45)).slice(0, 5),
    shuffle(range(46, 60)).slice(0, 5),
    shuffle(range(61, 75)).slice(0, 5),
  ];

  const card = [];
  const marked = [];
  for (let r = 0; r < 5; r++) {
    const row = [];
    const markRow = [];
    for (let c = 0; c < 5; c++) {
      const isFree = r === 2 && c === 2;
      row.push(isFree ? 0 : cols[c][r]);
      markRow.push(isFree);
    }
    card.push(row);
    marked.push(markRow);
  }
  return { card, marked };
}

// 👈 1250 ካርዶች
const TOTAL_CARDS = 1250;

function generateCards(count = TOTAL_CARDS) {
  const arr = [];
  for (let i = 1; i <= count; i++) {
    const { card, marked } = generate75BallCard();
    arr.push({ cardId: i, card, marked });
  }
  return arr;
}

// Backward-compatible aliases
const generate1000Cards = () => generateCards(TOTAL_CARDS);
const generate1250Cards = () => generateCards(TOTAL_CARDS);

// ═══════════════════════════════════════════════════════
// WIN PATTERNS
// ═══════════════════════════════════════════════════════
const WIN_PATTERNS = [
  "any-row",
  "any-column",
  "any-diagonal",
  "four-corners",
  "full-card",
];

function randomWinPattern() {
  return WIN_PATTERNS[Math.floor(Math.random() * WIN_PATTERNS.length)];
}

// 👈 Pattern by room fee
function getPatternForRoom(entryFee) {
  if (entryFee <= 10) return "any-row";
  if (entryFee <= 20) return "any-column";
  if (entryFee <= 50) return "any-diagonal";
  return "full-card";
}

function patternLabel(pattern) {
  const labels = {
    "any-row": "ማንኛውም ረድፍ (Any Row)",
    "any-column": "ማንኛውም አምድ (Any Column)",
    "any-diagonal": "ዲያጎናል (Diagonal)",
    "four-corners": "4 ማዕዘን (4 Corners)",
    "full-card": "ሙሉ ካርድ (Full Card)",
  };
  return labels[pattern] || pattern;
}

function checkWin(marked, targetPattern) {
  const findRow = () => {
    for (let r = 0; r < 5; r++) {
      if (marked[r].every(Boolean)) return `row-${r + 1}`;
    }
    return null;
  };
  const findCol = () => {
    for (let c = 0; c < 5; c++) {
      if (marked.every((row) => row[c])) return `col-${c + 1}`;
    }
    return null;
  };
  const hasDiag1 = () => [0, 1, 2, 3, 4].every((i) => marked[i][i]);
  const hasDiag2 = () => [0, 1, 2, 3, 4].every((i) => marked[i][4 - i]);
  const hasFourCorners = () =>
    marked[0][0] && marked[0][4] && marked[4][0] && marked[4][4];
  const hasFull = () => marked.every((row) => row.every(Boolean));

  switch (targetPattern) {
    case "any-row":
      return findRow();
    case "any-column":
      return findCol();
    case "any-diagonal":
      if (hasDiag1()) return "diag-1";
      if (hasDiag2()) return "diag-2";
      return null;
    case "four-corners":
      return hasFourCorners() ? "four-corners" : null;
    case "full-card":
      return hasFull() ? "full-card" : null;
    default:
      return null;
  }
}

function markNumber(card, marked, number) {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (card[r][c] === number) marked[r][c] = true;
    }
  }
}

module.exports = {
  generate75BallCard,
  generateCards,
  generate1000Cards,
  generate1250Cards,
  TOTAL_CARDS,
  checkWin,
  markNumber,
  randomWinPattern,
  getPatternForRoom,
  patternLabel,
  WIN_PATTERNS,
};