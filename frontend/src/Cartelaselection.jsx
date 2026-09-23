import { useEffect, useRef, useState } from "react";
import { getSocket } from "./api";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

export default function CartelaSelection({
  roomCode,
  balance,
  stake = 10,
  onConfirm,
  onCancel,
}) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [deadlineAt, setDeadlineAt] = useState(null);
  const [error, setError] = useState("");
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [isWeekly, setIsWeekly] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);

  const triggeredRef = useRef(false);
  const fetchedRef = useRef(false);
  const confirmLockRef = useRef(false);

  const isWeeklyRoom = roomCode === "ROOM50" || roomCode === "ROOM100";
  const canAfford = currentBalance >= stake;

  // Reset on room change
  useEffect(() => {
    triggeredRef.current = false;
    fetchedRef.current = false;
    confirmLockRef.current = false;
    setDeadlineAt(null);
    setCountdown(null);
    setSelectedCards([]);
    setTakenCards([]);
    setError("");
    setFetchFailed(false);
    setLoading(true);
  }, [roomCode]);

  // Fetch room state
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const token = localStorage.getItem("bingo_token");
        const res = await fetch(`${API_BASE_URL}/api/game/rooms/${roomCode}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        if (data.takenCards) setTakenCards(data.takenCards);
        if (data.reservedCards) {
          setTakenCards((prev) => [
            ...new Set([...prev, ...data.reservedCards]),
          ]);
        }

        if (data.isWeeklyGame || isWeeklyRoom) {
          setIsWeekly(true);
          setCountdown(null);
          setDeadlineAt(null);
          setLoading(false);
          return;
        }

        let remaining = 0;
        let localDeadline = null;
        if (data.selectionEndsAt && data.serverTime) {
          const serverDeadline = new Date(data.selectionEndsAt).getTime();
          const serverNow = new Date(data.serverTime).getTime();
          if (Number.isFinite(serverDeadline) && Number.isFinite(serverNow)) {
            const clockOffset = serverNow - Date.now();
            localDeadline = serverDeadline - clockOffset;
            remaining = Math.max(
              0,
              Math.floor((localDeadline - Date.now()) / 1000)
            );
          }
        }
        if (localDeadline === null && typeof data.remainingSeconds === "number") {
          remaining = Math.max(0, data.remainingSeconds);
          if (remaining > 0) localDeadline = Date.now() + remaining * 1000;
        }
        if (localDeadline !== null) {
          setDeadlineAt(localDeadline);
          setCountdown(remaining);
        } else if (remaining === 0) {
          setCountdown(0);
        }
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("[Cartela] fetch error:", e);
        setFetchFailed(true);
        setLoading(false);
      }
    })();

    (async () => {
      try {
        const token = localStorage.getItem("bingo_token");
        const r = await fetch(`${API_BASE_URL}/api/wallet/balance`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        if (!cancelled && d.balance !== undefined) setCurrentBalance(d.balance);
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [roomCode, isWeeklyRoom, retryKey]);

  // Countdown
  useEffect(() => {
    if (isWeekly || !deadlineAt) return;
    const tick = () => {
      const rem = Math.max(0, Math.floor((deadlineAt - Date.now()) / 1000));
      setCountdown(rem);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadlineAt, isWeekly]);

  // Timer = 0 → go to game
  useEffect(() => {
    if (isWeekly) return;
    if (countdown === null || countdown > 0) return;
    if (triggeredRef.current || confirmLockRef.current) return;
    triggeredRef.current = true;
    confirmLockRef.current = true;

    // User selected cards → confirm
    if (selectedCards.length > 0 && canAfford) {
      return onConfirm(selectedCards, { spectate: false });
    }

    // No cards OR can't afford → spectate
    onConfirm([], { spectate: true });
  }, [countdown, selectedCards, canAfford, onConfirm, isWeekly]);

  // Socket
  useEffect(() => {
    const s = getSocket();
    const onSel = ({ cardId }) =>
      setTakenCards((p) => [...new Set([...p, cardId])]);
    const onDesel = ({ cardId }) =>
      setTakenCards((p) => p.filter((x) => x !== cardId));
    const onBal = ({ balance: b }) => setCurrentBalance(b);
    const onErr = ({ message }) => setError(message);

    s.on("card_selected", onSel);
    s.on("card_deselected", onDesel);
    s.on("balance_update", onBal);
    s.on("error_message", onErr);

    return () => {
      s.off("card_selected", onSel);
      s.off("card_deselected", onDesel);
      s.off("balance_update", onBal);
      s.off("error_message", onErr);
    };
  }, []);

  const handleSelect = (id) => {
    if (confirmLockRef.current) return;

    if (takenCards.includes(id) && !selectedCards.includes(id)) {
      return setError(`❌ ካርድ #${id} ተይዟል!`);
    }

    if (selectedCards.includes(id)) {
      getSocket().emit("deselect_card", { roomCode, cardId: id });
      setSelectedCards((p) => p.filter((x) => x !== id));
      setError("");
      return;
    }

    if (!canAfford) {
      return setError(
        `❌ በቂ ባላንስ የለዎትም! (${stake} ETB) — 👀 መመልከት ይችላሉ`
      );
    }

    getSocket().emit("select_card", { roomCode, cardId: id });
    setSelectedCards((p) => [...p, id]);
    setError("");
  };

  const confirmWeekly = () => {
    if (confirmLockRef.current) return;
    if (!selectedCards.length) return setError("❌ ቢያንስ አንድ ካርድ ይምረጡ!");
    if (!canAfford) return setError(`❌ በቂ ባላንስ የለዎትም!`);
    confirmLockRef.current = true;
    onConfirm(selectedCards, { spectate: false });
  };

  const goSpectator = () => {
    if (confirmLockRef.current) return;
    confirmLockRef.current = true;
    onConfirm([], { spectate: true });
  };

  const retryFetch = () => {
    fetchedRef.current = false;
    confirmLockRef.current = false;
    triggeredRef.current = false;
    setFetchFailed(false);
    setError("");
    setSelectedCards([]);
    setTakenCards([]);
    setRetryKey((k) => k + 1);
  };

  const numbers = Array.from({ length: 1000 }, (_, i) => i + 1);
  const total = selectedCards.length * stake;

  if (loading) {
    return (
      <div
        style={{
          padding: 20,
          maxWidth: 480,
          margin: "0 auto",
          color: "#fff",
          minHeight: "100vh",
          background: "#0f1420",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontSize: 60,
            marginBottom: 15,
            animation: "spin 2s linear infinite",
          }}
        >
          🎴
        </div>
        <div style={{ color: "#f39c12", fontSize: 14, fontWeight: "bold" }}>
          ካርቴላዎችን በመጫን ላይ...
        </div>
        <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
      </div>
    );
  }

  if (fetchFailed) {
    return (
      <div
        style={{
          padding: 20,
          maxWidth: 480,
          margin: "0 auto",
          color: "#fff",
          minHeight: "100vh",
          background: "#0f1420",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 50, marginBottom: 15 }}>⚠️</div>
        <div
          style={{
            color: "#e74c3c",
            fontSize: 14,
            marginBottom: 15,
            fontWeight: "bold",
          }}
        >
          ከሰርቨር ጋር መገናኘት አልተቻለም
        </div>
        <button
          onClick={retryFetch}
          style={{
            background: "#f39c12",
            color: "#111",
            border: "none",
            borderRadius: 10,
            padding: "12px 30px",
            fontWeight: "bold",
            fontSize: 14,
            cursor: "pointer",
            marginBottom: 10,
          }}
        >
          🔄 እንደገና ሞክር
        </button>
        <button
          onClick={onCancel}
          style={{
            background: "transparent",
            color: "#888",
            border: "1px solid #333",
            borderRadius: 10,
            padding: "10px 20px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ← ተመለስ
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 12,
        maxWidth: 480,
        margin: "0 auto",
        color: "#fff",
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0f1420 0%, #1a0f2e 100%)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button
        onClick={onCancel}
        style={{
          alignSelf: "flex-start",
          background: "#1a1a2e",
          border: "1px solid #4c6ef5",
          color: "#fff",
          borderRadius: 10,
          padding: "10px 18px",
          cursor: "pointer",
          marginBottom: 12,
          fontWeight: "bold",
        }}
      >
        ← Back
      </button>

      {/* Insufficient balance warning */}
      {!canAfford && (
        <div
          style={{
            background: "linear-gradient(135deg, #e74c3c, #c0392b)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            textAlign: "center",
            fontSize: 12,
            fontWeight: "bold",
            boxShadow: "0 4px 15px rgba(231,76,60,0.4)",
          }}
        >
          ⚠️ በቂ ብር የለዎትም ({stake} ETB ያስፈልጋል)
          <br />
          <span style={{ fontSize: 11, opacity: 0.9 }}>
            👀 ግን ጨዋታውን መመልከት ይችላሉ
          </span>
        </div>
      )}

      {/* Info Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
          background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
          border: "1px solid #f39c12",
          borderRadius: 12,
          padding: "12px 8px",
          marginBottom: 12,
          boxShadow: "0 4px 15px rgba(243,156,18,0.15)",
        }}
      >
        <InfoCell
          label="💰 Wallet"
          value={currentBalance}
          color={canAfford ? "#2ecc71" : "#e74c3c"}
        />
        <InfoCell label="🎯 Stake" value={stake} color="#f39c12" />
        <InfoCell
          label="🎴 Selected"
          value={selectedCards.length}
          color="#3498db"
        />
        <InfoCell
          label={isWeekly ? "🗓 Draw" : "⏱ Time"}
          value={
            isWeekly
              ? roomCode === "ROOM50"
                ? "12:00"
                : "12:05"
              : countdown !== null
              ? `${countdown}s`
              : "…"
          }
          color={
            isWeekly
              ? "#f39c12"
              : countdown !== null && countdown <= 10
              ? "#e74c3c"
              : "#ffd43b"
          }
        />
      </div>

      {/* Totals */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
          border: "1px solid #2a2a40",
          borderRadius: 10,
          padding: "10px 14px",
          marginBottom: 10,
          fontSize: 13,
          fontWeight: "bold",
        }}
      >
        <span>
          Selected: <b style={{ color: "#2ecc71" }}>{selectedCards.length}</b>
        </span>
        <span>
          Total: <b style={{ color: "#f39c12" }}>{total} ETB</b>
        </span>
      </div>

      {error && (
        <div
          style={{
            background: "linear-gradient(135deg, #e74c3c, #c0392b)",
            color: "#fff",
            padding: 10,
            borderRadius: 10,
            marginBottom: 10,
            fontSize: 12,
            textAlign: "center",
            fontWeight: "bold",
            boxShadow: "0 4px 12px rgba(231,76,60,0.4)",
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
          gap: 5,
          marginBottom: 10,
          paddingRight: 4,
          alignContent: "start",
          maxHeight: "calc(100vh - 440px)",
        }}
      >
        {numbers.map((n) => {
          const isTaken = takenCards.includes(n) && !selectedCards.includes(n);
          const isSelected = selectedCards.includes(n);
          return (
            <button
              key={n}
              onClick={() => handleSelect(n)}
              disabled={isTaken}
              style={{
                padding: "10px 0",
                borderRadius: 8,
                border: isSelected
                  ? "2px solid #2ecc71"
                  : "1px solid #2a2a40",
                background: isTaken
                  ? "linear-gradient(135deg, #c0392b, #8e1f1f)"
                  : isSelected
                  ? "linear-gradient(135deg, #2ecc71, #27ae60)"
                  : "linear-gradient(135deg, #1b2233, #151b2b)",
                color: "#fff",
                fontWeight: "bold",
                fontSize: 11,
                cursor: isTaken ? "not-allowed" : "pointer",
                opacity: isTaken ? 0.6 : 1,
                boxShadow: isSelected
                  ? "0 0 12px rgba(46,204,113,0.6)"
                  : "none",
                transition: "all 0.15s ease",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>

      {/* Weekly confirm */}
      {isWeekly && (
        <>
          <div
            style={{
              background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
              border: "1px solid #f39c12",
              borderRadius: 10,
              padding: 12,
              marginBottom: 10,
              textAlign: "center",
              fontSize: 11,
              color: "#f39c12",
              fontWeight: "bold",
            }}
          >
            🗓 ሳምንታዊ እጣ! ካርዶችዎን ይምረጡ
          </div>
          <button
            onClick={confirmWeekly}
            disabled={!selectedCards.length || !canAfford}
            style={{
              width: "100%",
              background:
                !selectedCards.length || !canAfford
                  ? "#555"
                  : "linear-gradient(135deg,#f39c12,#e67e22)",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: 14,
              fontSize: 14,
              fontWeight: "bold",
              cursor:
                !selectedCards.length || !canAfford ? "not-allowed" : "pointer",
              marginBottom: 10,
              boxShadow:
                !selectedCards.length || !canAfford
                  ? "none"
                  : "0 4px 15px rgba(243,156,18,0.5)",
            }}
          >
            ✅ Confirm ({selectedCards.length} ካርዶች, {total} ETB)
          </button>
        </>
      )}

      {/* Non-weekly info */}
      {!isWeekly && (
        <div
          style={{
            fontSize: 11,
            color: "#888",
            textAlign: "center",
            paddingBottom: 6,
          }}
        >
          ⏱ ሰዓቱ ሲያልቅ በራስ-ሰር ወደ ጨዋታው ይገባል
        </div>
      )}

      {/* Spectate button */}
      <button
        onClick={goSpectator}
        style={{
          width: "100%",
          background: "linear-gradient(135deg, #3498db, #2980b9)",
          color: "#fff",
          border: "none",
          borderRadius: 12,
          padding: 12,
          fontSize: 13,
          fontWeight: "bold",
          cursor: "pointer",
          marginTop: 6,
          marginBottom: 10,
          boxShadow: "0 4px 15px rgba(52,152,219,0.4)",
        }}
      >
        👀 ያለ ካርቴላ ይመልከቱ (Spectate)
      </button>
    </div>
  );
}

function InfoCell({ label, value, color = "#fff" }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: "#aaa", fontSize: 9, marginBottom: 3 }}>
        {label}
      </div>
      <div
        style={{
          color,
          fontSize: 14,
          fontWeight: "bold",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
    </div>
  );
}