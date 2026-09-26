import { useEffect, useRef, useState } from "react";
import { getSocket } from "./api";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

const TOTAL_CARDS = 1250;
const FALLBACK_TIMER_SEC = 50;

export default function CartelaSelection({
  roomCode,
  balance,
  stake = 10,
  onConfirm,
  onCancel,
}) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(FALLBACK_TIMER_SEC);
  const [deadlineAt, setDeadlineAt] = useState(
    Date.now() + FALLBACK_TIMER_SEC * 1000
  );
  const [error, setError] = useState("");
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [isWeekly, setIsWeekly] = useState(false);

  const triggeredRef = useRef(false);
  const fetchedRef = useRef(false);
  const confirmLockRef = useRef(false);

  const isWeeklyRoom = roomCode === "ROOM50" || roomCode === "ROOM100";

  useEffect(() => {
    triggeredRef.current = false;
    fetchedRef.current = false;
    confirmLockRef.current = false;
    setDeadlineAt(Date.now() + FALLBACK_TIMER_SEC * 1000);
    setCountdown(FALLBACK_TIMER_SEC);
    setSelectedCards([]);
    setTakenCards([]);
    setError("");
    setIsWeekly(false);
  }, [roomCode]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;

    const fetchRoom = async (attempt = 1) => {
      try {
        const token = localStorage.getItem("bingo_token");
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const res = await fetch(`${API_BASE_URL}/api/game/rooms/${roomCode}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        setError("");
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
          return;
        }

        let remaining = FALLBACK_TIMER_SEC;
        let localDeadline = null;
        if (data.selectionEndsAt && data.serverTime) {
          const sd = new Date(data.selectionEndsAt).getTime();
          const sn = new Date(data.serverTime).getTime();
          if (Number.isFinite(sd) && Number.isFinite(sn)) {
            const offset = sn - Date.now();
            localDeadline = sd - offset;
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
        if (localDeadline === null) {
          localDeadline = Date.now() + FALLBACK_TIMER_SEC * 1000;
          remaining = FALLBACK_TIMER_SEC;
        }
        setDeadlineAt(localDeadline);
        setCountdown(remaining);
      } catch (e) {
        if (cancelled) return;
        if (e.name === "AbortError" && attempt < 3) {
          setTimeout(() => fetchRoom(attempt + 1), 1000);
          return;
        }
        if (attempt < 3) {
          setTimeout(() => fetchRoom(attempt + 1), 1500 * attempt);
          return;
        }
        setError("⚠️ Offline — connecting...");
        setDeadlineAt(Date.now() + FALLBACK_TIMER_SEC * 1000);
        setCountdown(FALLBACK_TIMER_SEC);
      }
    };

    fetchRoom();

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
  }, [roomCode, isWeeklyRoom]);

  useEffect(() => {
    if (isWeekly || !deadlineAt) return;
    const tick = () => {
      const rem = Math.max(0, Math.floor((deadlineAt - Date.now()) / 1000));
      setCountdown(rem);
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [deadlineAt, isWeekly]);

  useEffect(() => {
    if (isWeekly) return;
    if (countdown === null || countdown > 0) return;
    if (triggeredRef.current || confirmLockRef.current) return;
    triggeredRef.current = true;
    confirmLockRef.current = true;

    if (selectedCards.length > 0) return onConfirm(selectedCards);

    const takenSet = new Set(takenCards);
    const free = [];
    for (let i = 1; i <= TOTAL_CARDS; i++)
      if (!takenSet.has(i)) free.push(i);

    if (free.length > 0) {
      const pick = free[Math.floor(Math.random() * free.length)];
      return onConfirm([pick]);
    }
    onConfirm([]);
  }, [countdown, selectedCards, takenCards, onConfirm, isWeekly]);

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
      return setError(`❌ Card #${id} taken!`);
    }
    if (selectedCards.includes(id)) {
      getSocket().emit("deselect_card", { roomCode, cardId: id });
      setSelectedCards((p) => p.filter((x) => x !== id));
      setError("");
      return;
    }
    getSocket().emit("select_card", { roomCode, cardId: id });
    setSelectedCards((p) => [...p, id]);
    setError("");
  };

  const confirmWeekly = () => {
    if (confirmLockRef.current) return;
    if (!selectedCards.length) return setError("❌ Select at least 1 card!");
    confirmLockRef.current = true;
    onConfirm(selectedCards);
  };

  const numbers = Array.from({ length: TOTAL_CARDS }, (_, i) => i + 1);
  const total = selectedCards.length * stake;

  // ⏱ Time color based on remaining
  const timeColor =
    countdown === null
      ? "#f39c12"
      : countdown <= 10
      ? "#e74c3c"
      : countdown <= 20
      ? "#f59e0b"
      : "#2ecc71";

  return (
    <div
      style={{
        padding: 12,
        maxWidth: 480,
        margin: "0 auto",
        color: "#fff",
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0a0a14 0%, #150a2e 100%)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Back button */}
      <button
        onClick={onCancel}
        style={{
          alignSelf: "flex-start",
          background: "rgba(26,26,46,0.8)",
          border: "1px solid rgba(76,110,245,0.5)",
          color: "#fff",
          borderRadius: 12,
          padding: "8px 16px",
          cursor: "pointer",
          marginBottom: 10,
          fontWeight: "bold",
          fontSize: 12,
          backdropFilter: "blur(10px)",
        }}
      >
        ← Back
      </button>

      {/* 👑 Header */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: "900",
            background:
              "linear-gradient(135deg, #f39c12, #ffd43b, #f39c12)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            letterSpacing: 0.5,
          }}
        >
          🎴 CHOOSE CARDS
        </div>
        <div
          style={{
            color: "#888",
            fontSize: 10,
            letterSpacing: 3,
            fontWeight: "700",
            marginTop: 4,
          }}
        >
          {roomCode} • STAKE {stake} ETB
        </div>
      </div>

      {/* Stats Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
          marginBottom: 10,
        }}
      >
        <StatBox
          icon="💰"
          label="Wallet"
          value={currentBalance}
          color="#2ecc71"
        />
        <StatBox
          icon="🎯"
          label="Stake"
          value={stake}
          color="#f39c12"
        />
        <StatBox
          icon="🎴"
          label="Selected"
          value={selectedCards.length}
          color="#3498db"
        />
        <StatBox
          icon={isWeekly ? "🗓" : "⏱"}
          label={isWeekly ? "Draw" : "Time"}
          value={
            isWeekly
              ? roomCode === "ROOM50"
                ? "12:00"
                : "12:05"
              : countdown !== null
              ? `${countdown}s`
              : "…"
          }
          color={isWeekly ? "#f39c12" : timeColor}
          pulse={!isWeekly && countdown !== null && countdown <= 10}
        />
      </div>

      {/* Progress bar for time */}
      {!isWeekly && countdown !== null && (
        <div
          style={{
            width: "100%",
            height: 4,
            background: "rgba(26,26,46,0.8)",
            borderRadius: 2,
            marginBottom: 10,
            overflow: "hidden",
            border: "1px solid rgba(42,42,64,0.6)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, (countdown / 50) * 100)}%`,
              background: `linear-gradient(90deg, ${timeColor}, ${timeColor}cc)`,
              borderRadius: 2,
              boxShadow: `0 0 10px ${timeColor}`,
              transition: "width 0.3s linear",
            }}
          />
        </div>
      )}

      {/* Total display */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background:
            "linear-gradient(135deg, rgba(26,26,46,0.7), rgba(15,20,32,0.9))",
          border: "1px solid rgba(243,156,18,0.3)",
          borderRadius: 12,
          padding: "10px 14px",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 12, color: "#aaa", fontWeight: "700" }}>
          🎴 SELECTED:{" "}
          <b style={{ color: "#2ecc71", fontSize: 14 }}>
            {selectedCards.length}
          </b>
        </span>
        <span style={{ fontSize: 12, color: "#aaa", fontWeight: "700" }}>
          💵 TOTAL:{" "}
          <b style={{ color: "#f39c12", fontSize: 14 }}>{total} ETB</b>
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
            boxShadow: "0 4px 15px rgba(231,76,60,0.4)",
            animation: "fadeInUp 0.3s ease-out",
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
          gap: 4,
          marginBottom: 10,
          paddingRight: 4,
          alignContent: "start",
          maxHeight: "calc(100vh - 340px)",
          WebkitOverflowScrolling: "touch",
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
                  : isTaken
                  ? "1px solid #8e1f1f"
                  : "1px solid #2a2a40",
                background: isTaken
                  ? "linear-gradient(135deg, #c0392b, #8e1f1f)"
                  : isSelected
                  ? "linear-gradient(135deg, #2ecc71, #27ae60)"
                  : "linear-gradient(135deg, #1b2233, #151b2b)",
                color: "#fff",
                fontWeight: "900",
                fontSize: 11,
                cursor: isTaken ? "not-allowed" : "pointer",
                opacity: isTaken ? 0.5 : 1,
                boxShadow: isSelected
                  ? "0 0 12px rgba(46,204,113,0.7), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "inset 0 1px 0 rgba(255,255,255,0.05)",
                transition: "all 0.1s ease",
                fontFamily: "inherit",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>

      {/* Weekly confirm */}
      {isWeekly && (
        <button
          onClick={confirmWeekly}
          disabled={!selectedCards.length}
          style={{
            width: "100%",
            background: !selectedCards.length
              ? "#555"
              : "linear-gradient(135deg,#f39c12,#e67e22)",
            color: "#fff",
            border: "none",
            borderRadius: 14,
            padding: 16,
            fontSize: 15,
            fontWeight: "900",
            cursor: !selectedCards.length ? "not-allowed" : "pointer",
            marginBottom: 8,
            boxShadow: !selectedCards.length
              ? "none"
              : "0 6px 20px rgba(243,156,18,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
            letterSpacing: 0.5,
          }}
        >
          ✅ CONFIRM ({selectedCards.length} cards, {total} ETB)
        </button>
      )}

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

function StatBox({ icon, label, value, color, pulse }) {
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${color}22, ${color}08)`,
        border: `1px solid ${color}66`,
        borderRadius: 12,
        padding: "10px 4px",
        textAlign: "center",
        position: "relative",
        boxShadow: `0 2px 10px ${color}22`,
        animation: pulse ? "pulse 1s ease-in-out infinite" : "none",
      }}
    >
      <div style={{ fontSize: 14, marginBottom: 2 }}>{icon}</div>
      <div
        style={{
          color: "#aaa",
          fontSize: 8,
          fontWeight: "700",
          letterSpacing: 0.5,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontSize: 13,
          fontWeight: "900",
          textShadow: `0 0 10px ${color}66`,
        }}
      >
        {value}
      </div>
    </div>
  );
}