import { useEffect, useState } from "react";
import { getSocket } from "./socket";

export default function CartelaSelection({ roomCode, balance, onConfirm, onCancel, stake }) {
  const [selectedCards, setSelectedCards] = useState([]); // 👈 ብዙ ካርዶች
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(60);
  const [error, setError] = useState("");
  const [currentBalance, setCurrentBalance] = useState(balance);

  useEffect(() => {
    const socket = getSocket();

    // የመጀመሪያ ሁኔታ
    fetch(`${process.env.REACT_APP_API_URL}/api/game/rooms/${roomCode}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("bingo_token")}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.takenCards) setTakenCards(data.takenCards);
      })
      .catch(() => {});

    // የ Real-time ማሳወቂያዎች
    socket.on("card_selected", ({ cardId, telegramId }) => {
      setTakenCards((prev) => [...new Set([...prev, cardId])]);
    });

    socket.on("card_deselected", ({ cardId }) => {
      setTakenCards((prev) => prev.filter((id) => id !== cardId));
    });

    socket.on("balance_update", ({ balance: newBal }) => {
      setCurrentBalance(newBal);
    });

    return () => {
      socket.off("card_selected");
      socket.off("card_deselected");
      socket.off("balance_update");
    };
  }, [roomCode]);

  // 👈 ሰዓቱ ሲያልቅ ወዲያውኑ ወደ ጨዋታው ይሂድ
  useEffect(() => {
    if (countdown <= 0) {
      // ካርድ ካልተመረጠ በራስ-ሰር አንዱን ምረጥ
      if (selectedCards.length === 0) {
        const available = Array.from({ length: 1000 }, (_, i) => i + 1).filter(
          (id) => !takenCards.includes(id)
        );
        if (available.length > 0) {
          const randomId = available[Math.floor(Math.random() * available.length)];
          onConfirm([randomId]); // 👈 array ላክ
          return;
        }
      }
      onConfirm(selectedCards); // 👈 የተመረጡትን ሁሉ ላክ
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, selectedCards, takenCards, onConfirm]);

  const handleSelectCard = (cardId) => {
    if (takenCards.includes(cardId)) {
      setError(`ካርድ #${cardId} አስቀድሞ ተይዟል!`);
      return;
    }
    if (selectedCards.includes(cardId)) {
      // አስቀድሞ ከመረጥከው ሰርዘው (ዲ ሰሌክት)
      const socket = getSocket();
      socket.emit("deselect_card", { roomCode, cardId });
      setSelectedCards((prev) => prev.filter((id) => id !== cardId));
      setError("");
      return;
    }
    if (currentBalance < stake) {
      setError(`❌ በቂ ባላንስ የለዎትም! (${stake} ETB ያስፈልጋል)`);
      return;
    }
    const socket = getSocket();
    socket.emit("select_card", { roomCode, cardId });
    setSelectedCards((prev) => [...prev, cardId]);
    setError("");
  };

  const numbers = Array.from({ length: 1000 }, (_, i) => i + 1);
  const totalCost = selectedCards.length * stake;

  return (
    <div style={{ padding: "15px", maxWidth: "480px", margin: "0 auto", color: "#fff", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <h2 style={{ fontSize: "16px", margin: 0 }}>🎴 Pick Your Cartela</h2>
        <div style={{ background: countdown <= 10 ? "#e74c3c" : "#f39c12", borderRadius: "20px", padding: "6px 14px", fontSize: "14px", fontWeight: "bold" }}>
          ⏱ {countdown}s
        </div>
      </div>

      {/* Room & Balance */}
      <div style={{ display: "flex", justifyContent: "space-between", background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "8px 12px", marginBottom: "8px", fontSize: "12px" }}>
        <span>Room: <b style={{color: "#f39c12"}}>{roomCode}</b></span>
        <span>Balance: <b style={{color: "#2ecc71"}}>{currentBalance} ETB</b></span>
      </div>

      {/* Selection Summary */}
      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "8px 12px", marginBottom: "10px", fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
        <span>Selected: <b style={{color: "#2ecc71"}}>{selectedCards.length}</b></span>
        <span>Total: <b style={{color: "#f39c12"}}>{totalCost} ETB</b></span>
      </div>

      {error && <div style={{ background: "#e74c3c", color: "#fff", padding: "6px", borderRadius: "8px", marginBottom: "8px", fontSize: "11px", textAlign: "center" }}>{error}</div>}

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "5px", marginBottom: "10px", paddingRight: "5px" }}>
        {numbers.map((num) => {
          const isTaken = takenCards.includes(num) && !selectedCards.includes(num);
          const isSelected = selectedCards.includes(num);
          return (
            <button
              key={num}
              onClick={() => handleSelectCard(num)}
              disabled={isTaken}
              style={{
                padding: "10px 0",
                borderRadius: "8px",
                border: "1px solid #333",
                background: isTaken ? "#c0392b" : isSelected ? "#2ecc71" : "#1b2233",
                color: "#fff",
                fontWeight: "bold",
                fontSize: "11px",
                cursor: isTaken ? "not-allowed" : "pointer",
              }}
            >
              {num}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: "11px", color: "#888", textAlign: "center", paddingBottom: "10px" }}>
        ሰዓቱ ሲያልቅ በራስ-ሰር ወደ ጨዋታው ይገባል
      </div>
    </div>
  );
}