/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState } from "react";
import { getSocket } from "./socket";

export default function CartelaSelection({ roomCode, balance, stake = 10, onConfirm, onCancel }) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(null); // 👈 መጀመሪያ null (ከ Server ይመጣል)
  const [error, setError] = useState("");
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [bonusBalance, setBonusBalance] = useState(0);
  const [autoTriggered, setAutoTriggered] = useState(false);
  const [serverTimeLoaded, setServerTimeLoaded] = useState(false);
  const [initialTimeReceived, setInitialTimeReceived] = useState(false);

  // 👈 ካርድ ሲመረጥ አረንጓዴ፣ ሌላ ሰው ሲመርጥ ቀይ
  const getCardColor = (num) => {
    if (selectedCards.includes(num)) return "#2ecc71"; // 🟢 የእኔ
    if (takenCards.includes(num)) return "#e74c3c";    // 🔴 የሌላ
    return "#1b2233";                                   // ⚫ ክፍት
  };

  useEffect(() => {
    const socket = getSocket();

    const fetchInitial = async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_URL}/api/game/rooms/${roomCode}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("bingo_token")}` },
        });
        const data = await res.json();

        // 👈 የሌሎች ሰዎች ካርዶች ብቻ
        const othersReserved = (data.reservedCards || []).filter(
          (id) => !selectedCards.includes(id)
        );
        if (data.takenCards) setTakenCards(data.takenCards);
        if (othersReserved.length > 0) {
          setTakenCards((prev) => [...new Set([...prev, ...othersReserved])]);
        }

        // 👈 ሰዓቱን ከ Server አስላ
        if (data.selectionEndsAt) {
          const remaining = Math.max(0, Math.floor((new Date(data.selectionEndsAt) - Date.now()) / 1000));
          // 👈 ሰዓቱ ካለፈ 50s ብቻ ከሆነ ተጠቀም (ወደ 0 አይሂድም)
          setCountdown(remaining > 0 ? remaining : 50);
        } else {
          setCountdown(50);
        }
        setServerTimeLoaded(true);
        // 👈 ከ5 ሰከንድ በኋላ ብቻ auto-trigger እንዲፈቀድ
        setTimeout(() => setInitialTimeReceived(true), 5000);
      } catch (e) {
        setCountdown(50);
        setServerTimeLoaded(true);
        setTimeout(() => setInitialTimeReceived(true), 5000);
      }
    };
    fetchInitial();

    // 👈 Wallet
    fetch(`${process.env.REACT_APP_API_URL}/api/wallet/balance`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("bingo_token")}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.balance !== undefined) setCurrentBalance(data.balance);
        if (data.bonusBalance !== undefined) setBonusBalance(data.bonusBalance);
      })
      .catch(() => {});

    // 👈 ካርድ ሲመረጥ (በሌሎች ወይም በእኔ)
    socket.on("card_selected", ({ cardId, telegramId }) => {
      const myTelegramId = localStorage.getItem("telegramId");
      if (String(telegramId) === String(myTelegramId)) {
        setSelectedCards((prev) => [...new Set([...prev, cardId])]);
      }
      setTakenCards((prev) => [...new Set([...prev, cardId])]);
    });

    socket.on("card_deselected", ({ cardId, telegramId }) => {
      const myTelegramId = localStorage.getItem("telegramId");
      if (String(telegramId) === String(myTelegramId)) {
        setSelectedCards((prev) => prev.filter((id) => id !== cardId));
      }
      setTakenCards((prev) => prev.filter((id) => id !== cardId));
    });

    socket.on("balance_update", ({ balance: newBal }) => {
      setCurrentBalance(newBal);
    });

    socket.on("room_state", (state) => {
      if (state.selectionEndsAt) {
        const remaining = Math.max(0, Math.floor((new Date(state.selectionEndsAt) - Date.now()) / 1000));
        // 👈 ሰዓቱ ካለፈ 50s ብቻ ከሆነ ተጠቀም
        setCountdown(remaining > 0 ? remaining : 50);
      }
      if (state.takenCards) setTakenCards(state.takenCards);
    });

    return () => {
      socket.off("card_selected");
      socket.off("card_deselected");
      socket.off("balance_update");
      socket.off("room_state");
    };
  }, [roomCode]);

  // 👈 የሰዓት ቆጣሪ — በየ 3 ሰከንዱ ከ Server አድስ
  useEffect(() => {
    if (!serverTimeLoaded) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_URL}/api/game/rooms/${roomCode}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("bingo_token")}` },
        });
        const data = await res.json();
        if (data.selectionEndsAt) {
          const remaining = Math.max(0, Math.floor((new Date(data.selectionEndsAt) - Date.now()) / 1000));
          // 👈 ሰዓቱ ካለፈ 50s ብቻ ከሆነ ተጠቀም
          setCountdown(remaining > 0 ? remaining : 50);
        }
      } catch (e) {}
    }, 3000);
    return () => clearInterval(timer);
  }, [roomCode, serverTimeLoaded]);

  // 👈 የአካባቢ ቆጣሪ
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // 👈 ሰዓቱ ሲያልቅ ወዲያውኑ ወደ ጨዋታው ሂድ
  // 👈 ግን serverTimeLoaded ካልሆነ ወይም initialTimeReceived ካልሆነ አይፈጸምም
  useEffect(() => {
    if (!serverTimeLoaded) return;        // 👈 ከ Server መረጃ ካልመጣ አይሂድ
    if (!initialTimeReceived) return;     // 👈 ከ 5 ሰከንድ በኋላ ብቻ
    if (countdown === null || countdown > 0 || autoTriggered) return;
    setAutoTriggered(true);
    if (selectedCards.length === 0) {
      const available = Array.from({ length: 1000 }, (_, i) => i + 1).filter(
        (id) => !takenCards.includes(id) && !selectedCards.includes(id)
      );
      if (available.length > 0) {
        const randomId = available[Math.floor(Math.random() * available.length)];
        onConfirm([randomId]);
        return;
      }
    }
    onConfirm(selectedCards);
  }, [countdown, selectedCards, takenCards, onConfirm, autoTriggered, initialTimeReceived, serverTimeLoaded]);

  const handleSelectCard = (cardId) => {
    const socket = getSocket();
    if (selectedCards.includes(cardId)) {
      // አስቀድሞ ከመረጥከው - ሰርዝ (refund)
      socket.emit("deselect_card", { roomCode, cardId });
      setSelectedCards((prev) => prev.filter((id) => id !== cardId));
      setTakenCards((prev) => prev.filter((id) => id !== cardId));
      setError("");
      return;
    }
    if (takenCards.includes(cardId)) {
      setError(`❌ ካርድ #${cardId} አስቀድሞ በሌላ ተጫዋች ተይዟል!`);
      return;
    }
    if (currentBalance < stake) {
      setError(`❌ በቂ ባላንስ የለዎትም! (${stake} ETB ያስፈልጋል)`);
      return;
    }
    socket.emit("select_card", { roomCode, cardId });
    setSelectedCards((prev) => [...new Set([...prev, cardId])]);
    setError("");
  };

  const handleRefresh = async () => {
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL}/api/game/rooms/${roomCode}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("bingo_token")}` },
      });
      const data = await res.json();
      if (data.takenCards) setTakenCards(data.takenCards);
      if (data.reservedCards) {
        const othersReserved = data.reservedCards.filter(
          (id) => !selectedCards.includes(id)
        );
        setTakenCards((prev) => [...new Set([...prev, ...othersReserved])]);
      }
      if (data.selectionEndsAt) {
        const remaining = Math.max(0, Math.floor((new Date(data.selectionEndsAt) - Date.now()) / 1000));
        setCountdown(remaining > 0 ? remaining : 50);
      }
    } catch (e) {}
  };

  const numbers = Array.from({ length: 1000 }, (_, i) => i + 1);
  const totalCost = selectedCards.length * stake;

  return (
    <div style={{ padding: "10px", maxWidth: "480px", margin: "0 auto", color: "#fff", height: "100vh", display: "flex", flexDirection: "column", background: "#0f1420" }}>
      {/* Top Row: Back + Refresh */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <button
          onClick={onCancel}
          style={{
            background: "#1a1a2e",
            border: "1px solid #4c6ef5",
            color: "#fff",
            borderRadius: "10px",
            padding: "10px 18px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>
        <button
          onClick={handleRefresh}
          style={{
            background: "#1a1a2e",
            border: "1px solid #4c6ef5",
            color: "#fff",
            borderRadius: "10px",
            padding: "10px 18px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Info Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "5px",
          background: "#1a1a2e",
          border: "1px solid #2a2a40",
          borderRadius: "10px",
          padding: "10px 8px",
          marginBottom: "10px",
        }}
      >
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
          <div style={{ color: countdown !== null && countdown <= 10 ? "#e74c3c" : "#ffd43b", fontSize: "16px", fontWeight: "bold" }}>
            {countdown !== null ? `${countdown} S` : "…"}
          </div>
        </div>
      </div>

      {/* Selection Summary */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          background: "#1a1a2e",
          border: "1px solid #2a2a40",
          borderRadius: "10px",
          padding: "8px 12px",
          marginBottom: "10px",
          fontSize: "12px",
        }}
      >
        <span>
          Selected: <b style={{ color: "#2ecc71" }}>{selectedCards.length}</b>
        </span>
        <span>
          Total: <b style={{ color: "#f39c12" }}>{totalCost} ETB</b>
        </span>
      </div>

      {error && (
        <div
          style={{
            background: "#e74c3c",
            color: "#fff",
            padding: "6px",
            borderRadius: "8px",
            marginBottom: "8px",
            fontSize: "11px",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      {/* Numbers Grid */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(8, 1fr)",
          gap: "5px",
          marginBottom: "10px",
          paddingRight: "5px",
          alignContent: "start",
        }}
      >
        {numbers.map((num) => {
          const isSelected = selectedCards.includes(num);
          const isTaken = takenCards.includes(num);
          return (
            <button
              key={num}
              onClick={() => handleSelectCard(num)}
              disabled={isTaken && !isSelected}
              style={{
                padding: "10px 0",
                borderRadius: "8px",
                border: isSelected ? "2px solid #2ecc71" : isTaken ? "1px solid #e74c3c" : "1px solid #333",
                background: getCardColor(num),
                color: "#fff",
                fontWeight: "bold",
                fontSize: "11px",
                cursor: isTaken && !isSelected ? "not-allowed" : "pointer",
                opacity: isTaken && !isSelected ? 0.75 : 1,
              }}
            >
              {num}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: "11px", color: "#888", textAlign: "center", paddingBottom: "10px" }}>
        🟢 አረንጓዴ = የእኔ | 🔴 ቀይ = የሌላ ተጫዋች
      </div>
    </div>
  );
}