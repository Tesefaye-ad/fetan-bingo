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

function checkWin(marked) {
  for (let r = 0; r < 5; r++) {
    if (marked[r].every(Boolean)) return `row-${r + 1}`;
  }
  for (let c = 0; c < 5; c++) {
    if (marked.every((row) => row[c])) return `col-${c + 1}`;
  }
  if ([0, 1, 2, 3, 4].every((i) => marked[i][i])) return "diag-1";
  if ([0, 1, 2, 3, 4].every((i) => marked[i][4 - i])) return "diag-2";
  if (marked.every((row) => row.every(Boolean))) return "full-card";
  return null;
}

function markNumber(card, marked, number) {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (card[r][c] === number) marked[r][c] = true;
    }
  }
}

module.exports = { generate75BallCard, generate1000Cards, checkWin, markNumber };