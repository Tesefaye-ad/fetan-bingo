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
  const columnsRanges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  const columns = columnsRanges.map(([start, end]) => shuffle(range(start, end)).slice(0, 5));

  const card = [];
  const marked = [];
  for (let row = 0; row < 5; row++) {
    const cardRow = [];
    const markedRow = [];
    for (let col = 0; col < 5; col++) {
      const isFree = row === 2 && col === 2;
      cardRow.push(isFree ? 0 : columns[col][row]);
      markedRow.push(isFree);
    }
    card.push(cardRow);
    marked.push(markedRow);
  }
  return { card, marked };
}

function generate1000Cards() {
  const allCards = [];
  for (let i = 1; i <= 1000; i++) {
    const { card, marked } = generate75BallCard();
    allCards.push({ cardId: i, card, marked });
  }
  return allCards;
}

function checkWin(marked) {
  const size = 5;
  for (let r = 0; r < size; r++) {
    if (marked[r].every(Boolean)) return `row-${r + 1}`;
  }
  for (let c = 0; c < size; c++) {
    if (marked.every((row) => row[c])) return `column-${c + 1}`;
  }
  if ([0, 1, 2, 3, 4].every((i) => marked[i][i])) return "diagonal-1";
  if ([0, 1, 2, 3, 4].every((i) => marked[i][size - 1 - i])) return "diagonal-2";
  if (marked.every((row) => row.every(Boolean))) return "full-card";
  return null;
}

function markNumber(card, marked, number) {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (card[r][c] === number) marked[r][c] = true;
    }
  }
  return marked;
}

module.exports = { generate75BallCard, generate1000Cards, checkWin, markNumber };