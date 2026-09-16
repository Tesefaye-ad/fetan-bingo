import React, { useEffect, useState } from "react";

export default function CartelaSelection({ roomCode, balance, onConfirm, onCancel }) {
  const [selectedCard, setSelectedCard] = useState(null);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(48);
  const [error, setError] = useState("");

  useEffect(() => {
    const apiBase = process.env.REACT_APP_API_URL || "";
    const token = localStorage.getItem("bingo_token") || "";
    fetch(`${apiBase}/api/game/rooms/${roomCode}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => { if (data.takenCards) setTakenCards(data.takenCards); })
      .catch(() => {});
  }, [roomCode]);

  useEffect(() => {
    if (countdown <= 0) {
      // Auto-pick a random free card if none chosen
      if (!selectedCard) {
        const takenSet = new Set(takenCards);
        for (let i = 1; i <= 1000; i++) {
          if (!takenSet.has(i)) { onConfirm(i); return; }
        }
      }
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, selectedCard, takenCards, onConfirm]);

  function handleConfirm() {
    if (!selectedCard) {
      setError("እባክዎ ካርቴላ ይምረጡ!");
      return;
    }
    if (takenCards.includes(selectedCard)) {
      setError("ይህ ካርቴላ አስቀድሞ ተይዟል!");
      return;
    }
    onConfirm(selectedCard);
  }

  const takenSet = new Set(takenCards);

  return (
    <div style={{ padding: "15px", maxWidth: "450px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
        <h2 style={{ color: "#fff", fontSize: "18px", margin: 0 }}>🎴 Pick Your Cartela</h2>
        <div style={{ background: countdown <= 10 ? "#e74c3c" : "#f39c12", color: "#fff", borderRadius: "20px", padding: "6px 14px", fontSize: "16px", fontWeight: "bold" }}>
          ⏱ {countdown}s
        </div>
      </div>

      <div style={{ background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "10px", padding: "10px", marginBottom: "15px", textAlign: "center" }}>
        <div style={{ color: "#aaa", fontSize: "11px" }}>Room</div>
        <div style={{ color: "#f39c12", fontSize: "16px", fontWeight: "bold" }}>{roomCode}</div>
      </div>

      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "10px", marginBottom: "15px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#fff", fontSize: "13px" }}>
          <span>💳 Balance:</span>
          <span style={{ fontWeight: "bold" }}>{balance} ETB</span>
        </div>
      </div>

      {error && (
        <div style={{ background: "#e74c3c", color: "#fff", padding: "8px", borderRadius: "8px", marginBottom: "15px", fontSize: "12px", textAlign: "center" }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: "15px" }}>
        <label style={{ display: "block", color: "#f39c12", fontSize: "12px", marginBottom: "5px" }}>Enter Card ID (1 - 1000):</label>
        <input
          type="number"
          min="1"
          max="1000"
          placeholder="e.g. 42"
          value={selectedCard || ""}
          onChange={(e) => { setSelectedCard(parseInt(e.target.value, 10)); setError(""); }}
          style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "12px", color: "#fff", fontSize: "16px", boxSizing: "border-box", textAlign: "center" }}
        />
        {selectedCard && (
          <div style={{ marginTop: "5px", fontSize: "12px", textAlign: "center" }}>
            {takenSet.has(selectedCard) ? (
              <span style={{ color: "#e74c3c", fontWeight: "bold" }}>🔴 ተይዟል (Taken)</span>
            ) : (
              <span style={{ color: "#2ecc71", fontWeight: "bold" }}>🟢 ክፍት ነው (Available)</span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <button onClick={onCancel} style={{ flex: 1, background: "#333c52", color: "#fff", border: "none", borderRadius: "10px", padding: "14px", fontWeight: "bold", cursor: "pointer" }}>
          Cancel
        </button>
        <button onClick={handleConfirm} disabled={!selectedCard} style={{ flex: 2, background: selectedCard && !takenSet.has(selectedCard) ? "#2ecc71" : "#666", color: "#fff", border: "none", borderRadius: "10px", padding: "14px", fontWeight: "bold", cursor: selectedCard ? "pointer" : "not-allowed" }}>
          Confirm & Play
        </button>
      </div>

      <div style={{ marginTop: "15px", fontSize: "11px", color: "#888", textAlign: "center" }}>
        Auto-selects a random card when timer hits 0
      </div>
    </div>
  );
}