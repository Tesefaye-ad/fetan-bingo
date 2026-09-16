import React from "react";

const HEADERS = ["B", "I", "N", "G", "O"];

export default function BingoCard({ card, marked, onCellClick, cardId }) {
  if (!card) return <p style={{ color: "#aaa" }}>Dealing your card…</p>;

  return (
    <div className="bingo-card" style={{ margin: "0 auto", maxWidth: "340px" }}>
      {cardId && (
        <div style={{ textAlign: "center", marginBottom: "8px", color: "#f39c12", fontWeight: "bold", fontSize: "14px" }}>
          Card #{cardId} (1 - 1000)
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px", marginBottom: "4px" }}>
        {HEADERS.map((h) => (
          <div key={h} style={{ textAlign: "center", fontWeight: "bold", color: "#4c6ef5", padding: "4px 0" }}>{h}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px" }}>
        {card.map((row, r) =>
          row.map((value, c) => {
            const isMarked = marked?.[r]?.[c];
            const isFree = r === 2 && c === 2;
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                onClick={() => !isFree && onCellClick(r, c)}
                style={{
                  aspectRatio: "1",
                  background: isFree ? "#ffd43b" : isMarked ? "#4c6ef5" : "#1b2233",
                  color: isFree ? "#1b2233" : "#fff",
                  fontSize: "16px",
                  fontWeight: "bold",
                  borderRadius: "8px",
                  border: "none",
                  cursor: isFree ? "default" : "pointer",
                }}
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