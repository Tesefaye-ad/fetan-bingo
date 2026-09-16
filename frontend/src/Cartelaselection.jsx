import React, { useEffect, useState } from "react";
import { getSocket } from "./socket";

export default function CartelaSelection({ roomCode, balance, onConfirm, onCancel }) {
  const [selectedCard, setSelectedCard] = useState(null);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(60);
  const [error, setError] = useState("");

  useEffect(() => {
    const socket = getSocket();
    
    // የመጀመሪያ ሁኔታን መጫን
    fetch(`${process.env.REACT_APP_API_URL}/api/game/rooms/${roomCode}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("bingo_token")}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.takenCards) setTakenCards(data.takenCards);
        if (data.reservedCards) {
          const reservedIds = data.reservedCards.map((r) => r.cardId);
          setTakenCards((prev) => [...new Set([...prev, ...reservedIds])]);
        }
      })
      .catch(() => {});

    // የ Real-time ማሳወቂያዎች
    socket.on("card_selected", ({ cardId, telegramId }) => {
      setTakenCards((prev) => [...prev, cardId]);
      if (String(telegramId) === String(localStorage.getItem("telegramId"))) {
        setSelectedCard(cardId);
      }
    });

    socket.on("card_deselected", ({ cardId }) => {
      setTakenCards((prev) => prev.filter((id) => id !== cardId));
      if (selectedCard === cardId) setSelectedCard(null);
    });

    return () => {
      socket.off("card_selected");
      socket.off("card_deselected");
    };
  }, [roomCode, selectedCard]);

  // የሰዓት ቆጣሪ እና ራስ-ሰር ምርጫ
  useEffect(() => {
    if (countdown <= 0) {
      if (!selectedCard) {
        const available = Array.from({ length: 1000 }, (_, i) => i + 1).filter(
          (id) => !takenCards.includes(id)
        );
        if (available.length > 0) {
          const randomId = available[Math.floor(Math.random() * available.length)];
          // በቀጥታ እዚህ ጋር እንመርጠው (ለ handleSelectCard ጥገኝነት እንዳይፈጠር)
          const socket = getSocket();
          socket.emit("select_card", { roomCode, cardId: randomId });
          setSelectedCard(randomId);
          setError("");
        }
      }
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, selectedCard, takenCards, roomCode]);

  const handleSelectCard = (cardId) => {
    if (takenCards.includes(cardId)) {
      setError(`ካርድ #${cardId} አስቀድሞ ተይዟል!`);
      return;
    }
    if (selectedCard === cardId) return;

    const socket = getSocket();
    socket.emit("select_card", { roomCode, cardId });
    setSelectedCard(cardId);
    setError("");
  };

  const handleDeselect = () => {
    if (!selectedCard) return;
    const socket = getSocket();
    socket.emit("deselect_card", { roomCode, cardId: selectedCard });
    setSelectedCard(null);
  };

  const handleConfirm = () => {
    if (!selectedCard) {
      setError("እባክዎ ካርቴላ ይምረጡ!");
      return;
    }
    onConfirm(selectedCard);
  };

  // ከ1 እስከ 1000 ያሉትን ቁጥሮች ማሳየት
  const numbers = Array.from({ length: 1000 }, (_, i) => i + 1);

  return (
    <div style={{ padding: "15px", maxWidth: "480px", margin: "0 auto", color: "#fff", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <h2 style={{ fontSize: "18px", margin: 0 }}>🎴 Pick Your Cartela</h2>
        <div style={{ background: countdown <= 10 ? "#e74c3c" : "#f39c12", borderRadius: "20px", padding: "6px 14px", fontSize: "16px", fontWeight: "bold" }}>
          ⏱ {countdown}s
        </div>
      </div>

      {/* Room & Balance */}
      <div style={{ display: "flex", justifyContent: "space-between", background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "10px", marginBottom: "10px", fontSize: "13px" }}>
        <span>Room: <b style={{color: "#f39c12"}}>{roomCode}</b></span>
        <span>Balance: <b style={{color: "#2ecc71"}}>{balance} ETB</b></span>
      </div>

      {error && <div style={{ background: "#e74c3c", color: "#fff", padding: "8px", borderRadius: "8px", marginBottom: "10px", fontSize: "12px", textAlign: "center" }}>{error}</div>}

      {/* Grid of 1000 numbers */}
      <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "5px", marginBottom: "15px", paddingRight: "5px" }}>
        {numbers.map((num) => {
          const isTaken = takenCards.includes(num);
          const isSelected = selectedCard === num;
          return (
            <button
              key={num}
              onClick={() => isTaken ? null : (isSelected ? handleDeselect() : handleSelectCard(num))}
              disabled={isTaken}
              style={{
                padding: "12px 0",
                borderRadius: "8px",
                border: "1px solid #333",
                background: isTaken ? "#e74c3c" : isSelected ? "#2ecc71" : "#1b2233",
                color: isTaken ? "#fff" : isSelected ? "#fff" : "#aaa",
                fontWeight: "bold",
                fontSize: "12px",
                cursor: isTaken ? "not-allowed" : "pointer",
              }}
            >
              {num}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", gap: "10px" }}>
        <button onClick={onCancel} style={{ flex: 1, background: "#333c52", color: "#fff", border: "none", borderRadius: "10px", padding: "14px", fontWeight: "bold" }}>
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!selectedCard}
          style={{
            flex: 2,
            background: selectedCard ? "#2ecc71" : "#666",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            padding: "14px",
            fontWeight: "bold",
            cursor: selectedCard ? "pointer" : "not-allowed",
          }}
        >
          Confirm & Play
        </button>
      </div>
      <div style={{ fontSize: "11px", color: "#888", textAlign: "center", marginTop: "8px" }}>
        Auto-selects a random card when timer hits 0
      </div>
    </div>
  );
}