import React, { useEffect, useState, useRef } from "react";
import { getSocket } from "./socket";

export default function CartelaSelection({ roomCode, balance, stake = 10, onConfirm, onCancel }) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [error, setError] = useState("");
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [bonusBalance, setBonusBalance] = useState(0);
  const [isWeekly, setIsWeekly] = useState(false);

  const autoTriggerRef = useRef(false);
  const timerStartedRef = useRef(false);

  // 👈 ሳምንታዊ ጨዋታ ነው?
  const isWeeklyRoom = roomCode === "ROOM50" || roomCode === "ROOM100";

  // ═══════════════════════════════════════════════════
  // አንድ ጊዜ ብቻ ከ Server ውሂብ አምጣ
  // ═══════════════════════════════════════════════════
  useEffect(() => {
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

        // 👈 ሳምንታዊ ጨዋታ ከሆነ — ሰዓት የለም
        if (data.isWeeklyGame || isWeeklyRoom) {
          setIsWeekly(true);
          setCountdown(null);
          timerStartedRef.current = false;
          console.log("[Cartela] Weekly game — no countdown");
        } else if (typeof data.remainingSeconds === "number") {
          setCountdown(data.remainingSeconds);
          timerStartedRef.current = true;
          console.log("[Cartela] Regular game — remaining:", data.remainingSeconds, "s");
        } else {
          setCountdown(50);
          timerStartedRef.current = true;
        }
      } catch (e) {
        console.error("[Cartela] fetch error:", e);
        if (!isWeeklyRoom) {
          setCountdown(50);
          timerStartedRef.current = true;
        }
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
  }, [roomCode, isWeeklyRoom]);

  // ═══════════════════════════════════════════════════
  // Socket events
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    const socket = getSocket();

    const onCardSelected = ({ cardId }) => {
      setTakenCards((prev) => [...new Set([...prev, cardId])]);
    };
    const onCardDeselected = ({ cardId }) => {
      setTakenCards((prev) => prev.filter((id) => id !== cardId));
    };
    const onBalanceUpdate = ({ balance: newBal }) => {
      setCurrentBalance(newBal);
    };

    socket.on("card_selected", onCardSelected);
    socket.on("card_deselected", onCardDeselected);
    socket.on("balance_update", onBalanceUpdate);

    return () => {
      socket.off("card_selected", onCardSelected);
      socket.off("card_deselected", onCardDeselected);
      socket.off("balance_update", onBalanceUpdate);
    };
  }, []);

  // ═══════════════════════════════════════════════════
  // ቆጣሪ — ለመደበኛ ጨዋታዎች ብቻ
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (isWeekly) return; // ሳምንታዊ ሰዓት የለውም
    if (!timerStartedRef.current) return;
    if (countdown === null || countdown <= 0) return;

    const timer = setTimeout(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, isWeekly]);

  // ═══════════════════════════════════════════════════
  // ሰዓቱ 0 ሲሆን ወደ ጨዋታው ሂድ — ለመደበኛ ጨዋታዎች ብቻ
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (isWeekly) return; // ሳምንታዊ አይሄድም
    if (!timerStartedRef.current) return;
    if (countdown === null || countdown > 0 || autoTriggerRef.current) return;

    autoTriggerRef.current = true;
    console.log("[Cartela] Countdown = 0, moving to game");

    if (selectedCards.length === 0) {
      const takenSet = new Set(takenCards);
      const available = [];
      for (let i = 1; i <= 1000; i++) {
        if (!takenSet.has(i)) available.push(i);
      }
      if (available.length > 0) {
        const randomId = available[Math.floor(Math.random() * available.length)];
        onConfirm([randomId]);
        return;
      }
    }
    onConfirm(selectedCards);
  }, [countdown, selectedCards, takenCards, onConfirm, isWeekly]);

  // ═══════════════════════════════════════════════════
  // የካርድ ምርጫ
  // ═══════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════
  // ሳምንታዊ — የተመረጡትን ካርዶች አረጋግጥ
  // ═══════════════════════════════════════════════════
  const handleConfirmWeekly = () => {
    if (selectedCards.length === 0) {
      setError("❌ እባክዎ ቢያንስ አንድ ካርድ ይምረጡ!");
      return;
    }
    onConfirm(selectedCards);
  };

  const numbers = Array.from({ length: 1000 }, (_, i) => i + 1);
  const totalCost = selectedCards.length * stake;

  return (
    <div style={{ padding: "10px", maxWidth: "480px", margin: "0 auto", color: "#fff", height: "100vh", display: "flex", flexDirection: "column", background: "#0f1420" }}>
      {/* Top Row — Back */}
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
          <div style={{ color: "#aaa", fontSize: "10px", marginBottom: "3px" }}>
            {isWeekly ? "Draw" : "Time"}
          </div>
          <div style={{
            color: isWeekly ? "#f39c12" : (countdown !== null && countdown <= 10 ? "#e74c3c" : "#ffd43b"),
            fontSize: isWeekly ? "11px" : "16px",
            fontWeight: "bold",
            lineHeight: "1.2",
          }}>
            {isWeekly
              ? (roomCode === "ROOM50" ? "ቅዳሜ 12:00" : "ቅዳሜ 12:05")
              : (countdown !== null ? `${countdown} S` : "…")}
          </div>
        </div>
      </div>

      {/* Summary */}
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

      {/* Bottom Message */}
      {isWeekly ? (
        <>
          <div style={{
            background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "10px",
            padding: "10px", marginBottom: "10px", textAlign: "center", fontSize: "11px", color: "#f39c12",
          }}>
            🗓 ይህ ሳምንታዊ እጣ ነው! ካርዶችዎን ይምረጡ። ጨዋታው ይጀመራል{" "}
            <b>{roomCode === "ROOM50" ? "ቅዳሜ ማታ 12:00" : "ቅዳሜ ማታ 12:05"}</b>
          </div>
          <button
            onClick={handleConfirmWeekly}
            disabled={selectedCards.length === 0}
            style={{
              width: "100%",
              background: selectedCards.length === 0
                ? "#555"
                : "linear-gradient(135deg, #f39c12, #e67e22)",
              color: "#fff",
              border: "none",
              borderRadius: "12px",
              padding: "14px",
              fontSize: "14px",
              fontWeight: "bold",
              cursor: selectedCards.length === 0 ? "not-allowed" : "pointer",
              marginBottom: "10px",
            }}
          >
            ✅ Confirm ({selectedCards.length} ካርዶች, {totalCost} ETB)
          </button>
        </>
      ) : (
        <div style={{ fontSize: "11px", color: "#888", textAlign: "center", paddingBottom: "10px" }}>
        
        </div>
      )}
    </div>
  );
}