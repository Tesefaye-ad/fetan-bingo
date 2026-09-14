import React from "react";

const HEADERS = ["B", "I", "N", "G", "O"];

export default function BingoCard({ card, marked, onCellClick, cardId }) {
  if (!card) {
    return <p className="hint">Dealing your card…</p>;
  }

  return (
    <div className="bingo-card">
      {cardId && (
        <div className="bingo-card-title" style={{ textAlign: "center", marginBottom: "8px", color: "#f39c12", fontWeight: "bold", fontSize: "14px" }}>
          Card #{cardId} (1 - 1000)
        </div>
      )}
      <div className="bingo-headers">
        {HEADERS.map((h) => (
          <div key={h} className="bingo-header-cell">
            {h}
          </div>
        ))}
      </div>
      <div className="bingo-grid">
        {card.map((row, r) =>
          row.map((value, c) => {
            const isMarked = marked?.[r]?.[c];
            const isFree = r === 2 && c === 2;
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                className={`bingo-cell ${isMarked ? "marked" : ""} ${
                  isFree ? "free" : ""
                }`}
                onClick={() => !isFree && onCellClick(r, c)}
              >
                {isFree ? "★" : value}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}