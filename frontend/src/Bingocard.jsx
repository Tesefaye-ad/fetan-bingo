import React from "react";

const HEADERS = ["B", "I", "N", "G", "O"];

export default function BingoCard({ card, marked, onCellClick, cardId }) {
  if (!card) {
    return <p style={{ color: "#aaa", textAlign: "center" }}>Dealing your card…</p>;
  }

  return (
    <div className="bingo-card" style={{ margin: "0 auto", maxWidth: "340px" }}>
      {cardId && (
        <div style={{
          textAlign: "center",
          marginBottom: "10px",
          color: "#f39c12",
          fontWeight: "bold",
          fontSize: "14px",
          background: "#1a1a2e",
          padding: "6px",
          borderRadius: "8px",
          border: "1px solid #2a2a40"
        }}>
          🎴 Card #{cardId} <span style={{ color: "#888", fontWeight: "normal" }}>(1 - 1000)</span>
        </div>
      )}

      {/* B-I-N-G-O Headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px", marginBottom: "6px" }}>
        {HEADERS.map((h) => (
          <div key={h} style={{
            textAlign: "center",
            fontWeight: "bold",
            color: "#fff",
            padding: "8px 0",
            background: "linear-gradient(135deg, #4c6ef5, #3b5bdb)",
            borderRadius: "8px",
            fontSize: "16px"
          }}>
            {h}
          </div>
        ))}
      </div>

      {/* 5x5 Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px" }}>
        {card.map((row, r) =>
          row.map((value, c) => {
            const isMarked = marked?.[r]?.[c];
            const isFree = r === 2 && c === 2;
            const isCalled = value !== 0 && isMarked;

            return (
              <button
                key={`${r}-${c}`}
                type="button"
                onClick={() => !isFree && onCellClick(r, c)}
                style={{
                  aspectRatio: "1",
                  background: isFree
                    ? "#ffd43b"
                    : isMarked
                    ? "#4c6ef5"
                    : "#1b2233",
                  color: isFree ? "#1b2233" : "#fff",
                  fontSize: "16px",
                  fontWeight: "bold",
                  borderRadius: "8px",
                  border: isMarked && !isFree ? "2px solid #ffd43b" : "1px solid #2a2a40",
                  cursor: isFree ? "default" : "pointer",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative"
                }}
              >
                {isFree ? "★" : value}
                {/* የተጠራ ምልክት (ትንሽ ነጥብ ከላይ) */}
                {isCalled && (
                  <span style={{
                    position: "absolute",
                    top: "2px",
                    right: "4px",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#2ecc71"
                  }} />
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Legend */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        gap: "15px",
        marginTop: "12px",
        fontSize: "11px",
        color: "#aaa"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "10px", height: "10px", background: "#1b2233", borderRadius: "3px", border: "1px solid #2a2a40" }}></span>
          Not marked
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "10px", height: "10px", background: "#4c6ef5", borderRadius: "3px" }}></span>
          Marked
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "10px", height: "10px", background: "#ffd43b", borderRadius: "3px" }}></span>
          FREE
        </div>
      </div>
    </div>
  );
}