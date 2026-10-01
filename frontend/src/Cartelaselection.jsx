import { useEffect, useRef, useState } from "react";
import { getSocket } from "./api";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

const TOTAL_CARDS = 1250;
const FETCH_TIMEOUT_MS = 60000;
const DEFAULT_TIMER_SEC = 50;
const RESYNC_INTERVAL_MS = 15000; // 👈 በየ 15s ከሰርቨር ጋር ያመሳስላል

function formatHHMMSS(totalSeconds) {
  if (totalSeconds == null || totalSeconds < 0) return "--:--:--";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(
    2,
    "0"
  )}:${String(sec).padStart(2, "0")}`;
}

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

  const triggeredRef = useRef(false);
  const fetchedRef = useRef(false);
  const confirmLockRef = useRef(false);

  const isWeeklyRoom = roomCode === "ROOM50" || roomCode === "ROOM100";

  // ═══════════════════════════════════════════════════════
  // RESET ON ROOM CHANGE
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    triggeredRef.current = false;
    fetchedRef.current = false;
    confirmLockRef.current = false;
    setDeadlineAt(null);
    setCountdown(null);
    setSelectedCards([]);
    setTakenCards([]);
    setError("");
    setIsWeekly(isWeeklyRoom);
  }, [roomCode, isWeeklyRoom]);

  // ═══════════════════════════════════════════════════════
  // FETCH FROM SERVER — sets deadlineAt from remainingSeconds
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    let cancelled = false;

    const fetchRoom = async (attempt = 1) => {
      try {
        const token = localStorage.getItem("bingo_token");
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          FETCH_TIMEOUT_MS
        );

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

        // 👈 Use server-provided remainingSeconds
        let remaining = 0;
        if (typeof data.remainingSeconds === "number") {
          remaining = Math.max(0, data.remainingSeconds);
        } else if (data.selectionEndsAt && data.serverTime) {
          // Fallback: compute from timestamps
          const sd = new Date(data.selectionEndsAt).getTime();
          const sn = new Date(data.serverTime).getTime();
          if (Number.isFinite(sd) && Number.isFinite(sn)) {
            const offset = sn - Date.now();
            const localDeadline = sd - offset;
            remaining = Math.max(
              0,
              Math.floor((localDeadline - Date.now()) / 1000)
            );
          }
        }

        console.log(
          `[Cartela] ${roomCode} — remaining=${remaining}s weekly=${data.isWeeklyGame}`
        );

        // 👈 Set deadlineAt from remaining seconds
        const localDeadline = Date.now() + remaining * 1000;
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

        // Final fallback
        console.warn("[Cartela] Offline fallback");
        setError("⚠️ Offline mode — connecting...");
        if (!isWeeklyRoom) {
          setDeadlineAt(Date.now() + DEFAULT_TIMER_SEC * 1000);
          setCountdown(DEFAULT_TIMER_SEC);
        }
      }
    };

    fetchRoom();

    // Balance fetch
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

  // ═══════════════════════════════════════════════════════
  // PERIODIC RESYNC — keep in sync with server
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    if (!deadlineAt) return;
    const resync = setInterval(async () => {
      try {
        const token = localStorage.getItem("bingo_token");
        const res = await fetch(`${API_BASE_URL}/api/game/rooms/${roomCode}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.remainingSeconds === "number") {
          const newDeadline = Date.now() + data.remainingSeconds * 1000;
          setDeadlineAt(newDeadline);
        }
      } catch {}
    }, RESYNC_INTERVAL_MS);

    return () => clearInterval(resync);
  }, [roomCode, deadlineAt]);

  // ═══════════════════════════════════════════════════════
  // COUNTDOWN TICK — 100ms
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    if (!deadlineAt) return;
    const tick = () => {
      const rem = Math.max(0, Math.floor((deadlineAt - Date.now()) / 1000));
      setCountdown(rem);
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [deadlineAt]);

  // ═══════════════════════════════════════════════════════
  // TIMER = 0 → GO TO LIVE GAME
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    if (countdown === null || countdown > 0) return;
    if (triggeredRef.current || confirmLockRef.current) return;
    triggeredRef.current = true;
    confirmLockRef.current = true;

    console.log("[Cartela] Timer 0 → Live Game");

    if (selectedCards.length > 0) {
      return onConfirm(selectedCards);
    }

    // Auto-pick random free card
    const takenSet = new Set(takenCards);
    const free = [];
    for (let i = 1; i <= TOTAL_CARDS; i++) {
      if (!takenSet.has(i)) free.push(i);
    }
    if (free.length > 0) {
      const pick = free[Math.floor(Math.random() * free.length)];
      return onConfirm([pick]);
    }
    onConfirm([]);
  }, [countdown, selectedCards, takenCards, onConfirm]);

  // ═══════════════════════════════════════════════════════
  // SOCKET
  // ═══════════════════════════════════════════════════════
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

  const numbers = Array.from({ length: TOTAL_CARDS }, (_, i) => i + 1);
  const total = selectedCards.length * stake;
  const timeStr =
    countdown !== null ? formatHHMMSS(countdown) : "--:--:--";
  const isUrgent =
    !isWeekly && countdown !== null && countdown <= 10 && countdown > 0;

  return (
    <div
      style={{
        padding: 10,
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
          padding: "8px 16px",
          cursor: "pointer",
          marginBottom: 8,
          fontWeight: "bold",
          fontSize: 12,
        }}
      >
        ← Back
      </button>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div
          style={{
            color: "#f39c12",
            fontSize: 20,
            fontWeight: "900",
            letterSpacing: 1,
          }}
        >
          CHOOSE CARDS
        </div>
        <div
          style={{
            color: "#888",
            fontSize: 10,
            fontWeight: "bold",
            letterSpacing: 2,
            marginTop: 2,
          }}
        >
          {roomCode} • STAKE {stake} ETB
        </div>
      </div>

      {/* Info Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 4,
          background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
          border: "1px solid #f39c12",
          borderRadius: 10,
          padding: "8px 6px",
          marginBottom: 8,
        }}
      >
        <InfoCell label="💰" sub="Wallet" value={currentBalance} color="#2ecc71" />
        <InfoCell label="🎯" sub="Stake" value={stake} color="#f39c12" />
        <InfoCell
          label="🎴"
          sub="Selected"
          value={selectedCards.length}
          color="#3498db"
        />
        <InfoCell
          label="🕐"
          sub="Time"
          value={timeStr}
          color={isUrgent ? "#e74c3c" : "#ffd43b"}
          mono={true}
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
          padding: "8px 12px",
          marginBottom: 8,
          fontSize: 12,
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
            padding: 8,
            borderRadius: 8,
            marginBottom: 8,
            fontSize: 11,
            textAlign: "center",
            fontWeight: "bold",
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
          marginBottom: 8,
          paddingRight: 4,
          alignContent: "start",
          maxHeight: "calc(100vh - 280px)",
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
                padding: "9px 0",
                borderRadius: 6,
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
                fontSize: 10,
                cursor: isTaken ? "not-allowed" : "pointer",
                opacity: isTaken ? 0.6 : 1,
                boxShadow: isSelected
                  ? "0 0 10px rgba(46,204,113,0.6)"
                  : "none",
                transition: "all 0.08s ease",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InfoCell({ label, sub, value, color = "#fff", mono = false }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 12, marginBottom: 1 }}>{label}</div>
      <div style={{ color: "#888", fontSize: 8, marginBottom: 2 }}>{sub}</div>
      <div
        style={{
          color,
          fontSize: mono ? 13 : 14,
          fontWeight: "900",
          lineHeight: 1.2,
          fontFamily: mono ? "monospace" : "inherit",
          letterSpacing: mono ? 0.5 : 0,
          textShadow: `0 0 8px ${color}66`,
        }}
      >
        {value}
      </div>
    </div>
  );
}