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

function generate1000Cards() {
  const arr = [];
  for (let i = 1; i <= 1000; i++) {
    const { card, marked } = generate75BallCard();
    arr.push({ cardId: i, card, marked });
  }
  return arr;
}

// 👈 Winning patterns — one random pattern per game
const WIN_PATTERNS = ["any-row", "any-column", "any-diagonal", "full-card"];

function randomWinPattern() {
  return WIN_PATTERNS[Math.floor(Math.random() * WIN_PATTERNS.length)];
}

function patternLabel(pattern) {
  switch (pattern) {
    case "any-row": return "ማንኛውም ረድፍ (Any Row)";
    case "any-column": return "ማንኛውም አምድ (Any Column)";
    case "any-diagonal": return "ዲያጎናል (Diagonal)";
    case "full-card": return "ሙሉ ካርድ (Full Card)";
    default: return pattern;
  }
}

// 👈 Check if marked grid satisfies the TARGET pattern
function checkWin(marked, targetPattern) {
  const hasRow = () => [0, 1, 2, 3, 4].some((r) => marked[r].every(Boolean));
  const hasCol = () =>
    [0, 1, 2, 3, 4].some((c) => marked.every((row) => row[c]));
  const hasDiag1 = () => [0, 1, 2, 3, 4].every((i) => marked[i][i]);
  const hasDiag2 = () => [0, 1, 2, 3, 4].every((i) => marked[i][4 - i]);
  const hasFull = () => marked.every((row) => row.every(Boolean));

  switch (targetPattern) {
    case "any-row":
      return hasRow() ? "row" : null;
    case "any-column":
      return hasCol() ? "column" : null;
    case "any-diagonal":
      return hasDiag1() || hasDiag2() ? "diagonal" : null;
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
  generate1000Cards,
  checkWin,
  markNumber,
  randomWinPattern,
  patternLabel,
  WIN_PATTERNS,
};