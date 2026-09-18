import React, { useEffect, useState, useRef } from "react";
import { getSocket } from "./socket";

export default function CartelaSelection({ roomCode, balance, stake = 10, onConfirm, onCancel }) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(50);
  const [error, setError] = useState("");
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [bonusBalance, setBonusBalance] = useState(0);

  // 👈 የሰዓቱ መጨረሻ ጊዜ (timestamp) — አንድ ጊዜ ብቻ ይዘጋጃል
  const selectionEndsAtRef = useRef(null);
  const hasReceivedServerTime = useRef(false);
  const autoTriggerRef = useRef(false);

  // ═══════════════════════════════════════════════════
  // አንድ ጊዜ ብቻ ከ Server ሰዓቱን አምጣ
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    const socket = getSocket();

    const fetchInitial = async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_URL}/api/game/rooms/${roomCode}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("bingo_token")}` },
        });
        const data = await res.json();

        if (data.takenCards) setTakenCards(data.takenCards);
        if (data.reservedCards) {
          setTakenCards((prev) => [...new Set([...prev, ...data.reservedCards])]);
        }

        // 👈 የሰዓቱን መጨረሻ ጊዜ አስቀምጥ (timestamp) — ይህ ብቻ ነው ዋናው
        if (data.selectionEndsAt) {
          selectionEndsAtRef.current = new Date(data.selectionEndsAt).getTime();
        } else {
          selectionEndsAtRef.current = Date.now() + 50000;
        }
        hasReceivedServerTime.current = true;
      } catch (e) {
        selectionEndsAtRef.current = Date.now() + 50000;
        hasReceivedServerTime.current = true;
      }
    };
    fetchInitial();

    // Wallet
    fetch(`${process.env.REACT_APP_API_URL}/api/wallet/balance`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("bingo_token")}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.balance !== undefined) setCurrentBalance(data.balance);
        if (data.bonusBalance !== undefined) setBonusBalance(data.bonusBalance);
      })
      .catch(() => {});

    // Socket events
    socket.on("card_selected", ({ cardId }) => {
      setTakenCards((prev) => [...new Set([...prev, cardId])]);
    });

    socket.on("card_deselected", ({ cardId }) => {
      setTakenCards((prev) => prev.filter((id) => id !== cardId));
    });

    socket.on("balance_update", ({ balance: newBal }) => {
      setCurrentBalance(newBal);
    });

    // 👈 room_state — ሰዓቱን አይቀይርም (takenCards ብቻ አዘምን)
    socket.on("room_state", (state) => {
      if (state.takenCards) setTakenCards(state.takenCards);
    });

    return () => {
      socket.off("card_selected");
      socket.off("card_deselected");
      socket.off("balance_update");
      socket.off("room_state");
    };
  }, [roomCode]);

  // ═══════════════════════════════════════════════════
  // 👈 የሰዓት ቆጣሪ — በየ ሰከንዱ ከ timestamp አስላ
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    const tick = () => {
      if (!selectionEndsAtRef.current) return;
      const remaining = Math.max(0, Math.floor((selectionEndsAtRef.current - Date.now()) / 1000));
      setCountdown(remaining);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // ═══════════════════════════════════════════════════
  // ሰዓቱ 0 ሲሆን ወደ ጨዋታው ሂድ (አንድ ጊዜ ብቻ)
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (!hasReceivedServerTime.current) return;
    if (countdown > 0 || autoTriggerRef.current) return;

    autoTriggerRef.current = true;

    if (selectedCards.length === 0) {
      const available = Array.from({ length: 1000 }, (_, i) => i + 1).filter(
        (id) => !takenCards.includes(id)
      );
      if (available.length > 0) {
        const randomId = available[Math.floor(Math.random() * available.length)];
        onConfirm([randomId]);
        return;
      }
    }
    onConfirm(selectedCards);
  }, [countdown, selectedCards, takenCards, onConfirm]);

  const handleSelectCard = (cardId) => {
    if (takenCards.includes(cardId)) {
      setError(`ካርድ #${cardId} አስቀድሞ ተይዟል!`);
      return;
    }
    if (selectedCards.includes(cardId)) {
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

  const handleRefresh = async () => {
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL}/api/game/rooms/${roomCode}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("bingo_token")}` },
      });
      const data = await res.json();
      if (data.takenCards) setTakenCards(data.takenCards);
      // 👈 ሰዓቱን አትቀይር — selectionEndsAtRef አይነካ
    } catch (e) {}
  };

  const numbers = Array.from({ length: 1000 }, (_, i) => i + 1);
  const totalCost = selectedCards.length * stake;

  return (
    <div style={{ padding: "10px", maxWidth: "480px", margin: "0 auto", color: "#fff", height: "100vh", display: "flex", flexDirection: "column", background: "#0f1420" }}>
      {/* Top Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <button
          onClick={onCancel}
          style={{
            background: "#1a1a2e", border: "1px solid #4c6ef5", color: "#fff",
            borderRadius: "10px", padding: "10px 18px", fontSize: "14px",
            fontWeight: "bold", cursor: "pointer",
          }}
        >
          ← Back
        </button>
        <button
          onClick={handleRefresh}
          style={{
            background: "#1a1a2e", border: "1px solid #4c6ef5", color: "#fff",
            borderRadius: "10px", padding: "10px 18px", fontSize: "14px",
            fontWeight: "bold", cursor: "pointer",
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Info Row */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "5px",
        background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px",
        padding: "10px 8px", marginBottom: "10px",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#aaa", fontSize: "10px", marginBottom: "3px" }}>Main Wallet</div>
          <div style={{ color: "#fff", fontSize: "14px", fontWeight: "bold" }}>{currentBalance}</div>
        </div>
        <div style={{ textAlign: "center", borderLeft: "1px solid #2a2a40" }}>
          <div style={{ color: "#aaa", fontSize: "10px", marginBottom: "3px" }}>Play Wallet</div>
          <div style={{ color: "#fff", fontSize: "14px", fontWeight: "bold" }}>{bonusBalance}</div>
        </div>
        <div style={{ textAlign: "center", borderLeft: "1px solid #2a2a40" }}>
          <div style={{ color: "#aaa", fontSize: "10px", marginBottom: "3px" }}>Stake</div>
          <div style={{ color: "#fff", fontSize: "14px", fontWeight: "bold" }}>{stake}</div>
        </div>
        <div style={{ textAlign: "center", borderLeft: "1px solid #2a2a40" }}>
          <div style={{ color: "#aaa", fontSize: "10px", marginBottom: "3px" }}>Time</div>
          <div style={{ color: countdown <= 10 ? "#e74c3c" : "#ffd43b", fontSize: "16px", fontWeight: "bold" }}>
            {countdown} S
          </div>
        </div>
      </div>

      {/* Selection Summary */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        background: "#1a1a2e", border: "1px solid #2a2a40",
        borderRadius: "10px", padding: "8px 12px", marginBottom: "10px", fontSize: "12px",
      }}>
        <span>Selected: <b style={{ color: "#2ecc71" }}>{selectedCards.length}</b></span>
        <span>Total: <b style={{ color: "#f39c12" }}>{totalCost} ETB</b></span>
      </div>

      {error && (
        <div style={{
          background: "#e74c3c", color: "#fff", padding: "6px",
          borderRadius: "8px", marginBottom: "8px", fontSize: "11px", textAlign: "center",
        }}>
          {error}
        </div>
      )}

      {/* Numbers Grid */}
      <div style={{
        flex: 1, overflowY: "auto", display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)", gap: "5px",
        marginBottom: "10px", paddingRight: "5px", alignContent: "start",
      }}>
        {numbers.map((num) => {
          const isTaken = takenCards.includes(num) && !selectedCards.includes(num);
          const isSelected = selectedCards.includes(num);
          return (
            <button
              key={num}
              onClick={() => handleSelectCard(num)}
              disabled={isTaken}
              style={{
                padding: "10px 0", borderRadius: "8px",
                border: isSelected ? "2px solid #2ecc71" : "1px solid #333",
                background: isTaken ? "#c0392b" : isSelected ? "#2ecc71" : "#1b2233",
                color: "#fff", fontWeight: "bold", fontSize: "11px",
                cursor: isTaken ? "not-allowed" : "pointer",
                opacity: isTaken ? 0.7 : 1,
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