import { useEffect, useRef, useState } from "react";
import { getSocket } from "./api";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

const TOTAL_CARDS = 1250;
const FETCH_TIMEOUT_MS = 8000;
const MAX_RETRY = 20;
const DEFAULT_TIMER_SEC = 50;

// ═══════════════════════════════════════════════════════
// 🕐 Format helpers
// ═══════════════════════════════════════════════════════
function formatHHMMSS(totalSeconds) {
  if (totalSeconds == null || totalSeconds < 0) return "00:00:00";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(
    2,
    "0"
  )}:${String(sec).padStart(2, "0")}`;
}

function formatSecondsOnly(totalSeconds) {
  if (totalSeconds == null || totalSeconds < 0) return "0s";
  return `${Math.floor(totalSeconds)}s`;
}

// ═══════════════════════════════════════════════════════
// 🕐 ወደ 12:00 / 12:05 EAT የሚወስደውን ሰከንድ አስላ
// ═══════════════════════════════════════════════════════
function getSecondsUntilDaily(fee) {
  const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const et = new Date(now.getTime() + ETHIOPIA_OFFSET_MS);

  const targetHour = 0; // ማታ 12:00 EAT
  const targetMinute = fee === 50 ? 0 : 5;

  const today = new Date(et);
  today.setUTCHours(targetHour, targetMinute, 0, 0);

  let target = today.getTime();
  if (et.getTime() >= target) {
    target += 24 * 60 * 60 * 1000;
  }

  return Math.max(0, Math.floor((target - et.getTime()) / 1000));
}

export default function CartelaSelection({
  roomCode,
  balance,
  stake = 10,
  onConfirm,
  onCancel,
  onGameStatusChange,
}) {
  const isWeeklyRoom = roomCode === "ROOM50" || roomCode === "ROOM100";

  // ═══════════════════════════════════════════════════════
  // 👈 ወዲያውኑ የመጀመሪያ ሰዓት አስላ
  // ═══════════════════════════════════════════════════════
  const initialSeconds = isWeeklyRoom
    ? getSecondsUntilDaily(stake)
    : DEFAULT_TIMER_SEC;

  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(initialSeconds);
  const [deadlineAt, setDeadlineAt] = useState(
    Date.now() + initialSeconds * 1000
  );
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [isReady, setIsReady] = useState(false); // 👈 አሁን ጥቅም ላይ ይውላል

  const triggeredRef = useRef(false);
  const fetchedRef = useRef(false);
  const confirmLockRef = useRef(false);
  const serverOffsetRef = useRef(0); // 👈 server-client clock offset

  // ═══════════════════════════════════════════════════════
  // Room change — ወዲያውኑ ሰዓቱን አስላ
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    triggeredRef.current = false;
    fetchedRef.current = false;
    confirmLockRef.current = false;
    serverOffsetRef.current = 0;

    const secs = isWeeklyRoom ? getSecondsUntilDaily(stake) : DEFAULT_TIMER_SEC;
    setDeadlineAt(Date.now() + secs * 1000);
    setCountdown(secs);
    setSelectedCards([]);
    setTakenCards([]);
    setIsReady(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ═══════════════════════════════════════════════════════
  // FETCH ROOM
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;

    const fetchRoom = async (attempt = 1) => {
      if (cancelled) return;
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

        // 🕐 Server clock offset
        if (data.serverTime) {
          const serverNow = new Date(data.serverTime).getTime();
          if (Number.isFinite(serverNow)) {
            serverOffsetRef.current = serverNow - Date.now();
          }
        }

        if (data.takenCards) setTakenCards(data.takenCards);
        if (data.reservedCards) {
          setTakenCards((prev) => [
            ...new Set([...prev, ...data.reservedCards]),
          ]);
        }

        // Game already active → jump to LiveGame
        if (data.status === "active" || data.status === "finished") {
          if (!triggeredRef.current && !confirmLockRef.current) {
            triggeredRef.current = true;
            confirmLockRef.current = true;
            console.log("[Cartela] Game active — jumping");
            onGameStatusChange?.("active");
            return onConfirm([]);
          }
          return;
        }

        // ═══════════════════════════════════════════════════
        // 🕐 TIMER — Use server offset
        // ═══════════════════════════════════════════════════
        let remaining = 0;

        if (data.selectionEndsAt) {
          // Absolute deadline from server
          const serverDeadline = new Date(data.selectionEndsAt).getTime();
          if (Number.isFinite(serverDeadline)) {
            // Apply offset: convert to local time
            const localDeadline = serverDeadline - serverOffsetRef.current;
            remaining = Math.max(
              0,
              Math.floor((localDeadline - Date.now()) / 1000)
            );
          }
        }

        // Fallback: use remainingSeconds
        if (remaining === 0 && typeof data.remainingSeconds === "number") {
          remaining = Math.max(0, data.remainingSeconds);
        }

        console.log(
          `[Cartela] ${roomCode} remaining=${remaining}s (offset=${
            serverOffsetRef.current / 1000
          }s)`
        );

        // If remaining is 0 and game is still waiting → poll until it starts
        if (remaining === 0 && data.status === "waiting") {
          if (attempt < MAX_RETRY) {
            setTimeout(() => fetchRoom(attempt + 1), 300);
            return;
          }
          if (!triggeredRef.current) {
            triggeredRef.current = true;
            confirmLockRef.current = true;
            onGameStatusChange?.("active");
            return onConfirm([]);
          }
          return;
        }

        // 👈 ሰርቨር ሰዓቱን ሲልክ ብቻ ተካ
        if (remaining > 0) {
          setDeadlineAt(Date.now() + remaining * 1000);
          setCountdown(remaining);
        }
        setIsReady(true);
      } catch (e) {
        if (cancelled) return;
        if (attempt < MAX_RETRY) {
          setTimeout(() => fetchRoom(attempt + 1), 400);
          return;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ═══════════════════════════════════════════════════════
  // Countdown tick
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    if (!deadlineAt) return;
    const tick = () => {
      const rem = Math.max(0, Math.floor((deadlineAt - Date.now()) / 1000));
      setCountdown(rem);
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [deadlineAt]);

  // ═══════════════════════════════════════════════════════
  // Timer 0 → LiveGame
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    if (countdown === null || countdown > 0) return;
    if (!isReady) return; // 👈 Only after server sync
    if (triggeredRef.current || confirmLockRef.current) return;

    triggeredRef.current = true;
    confirmLockRef.current = true;
    console.log("[Cartela] Timer 0 → LiveGame");
    onGameStatusChange?.("active");

    if (selectedCards.length > 0) return onConfirm(selectedCards);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, selectedCards, takenCards, isReady]);

  // ═══════════════════════════════════════════════════════
  // Socket
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    const s = getSocket();
    const onSel = ({ cardId }) =>
      setTakenCards((p) => [...new Set([...p, cardId])]);
    const onDesel = ({ cardId }) =>
      setTakenCards((p) => p.filter((x) => x !== cardId));
    const onBal = ({ balance: b }) => setCurrentBalance(b);

    s.on("card_selected", onSel);
    s.on("card_deselected", onDesel);
    s.on("balance_update", onBal);

    return () => {
      s.off("card_selected", onSel);
      s.off("card_deselected", onDesel);
      s.off("balance_update", onBal);
    };
  }, []);

  const handleSelect = (id) => {
    if (confirmLockRef.current) return;
    if (takenCards.includes(id) && !selectedCards.includes(id)) return;
    if (selectedCards.includes(id)) {
      getSocket().emit("deselect_card", { roomCode, cardId: id });
      setSelectedCards((p) => p.filter((x) => x !== id));
      return;
    }
    getSocket().emit("select_card", { roomCode, cardId: id });
    setSelectedCards((p) => [...p, id]);
  };

  const numbers = Array.from({ length: TOTAL_CARDS }, (_, i) => i + 1);
  const total = selectedCards.length * stake;

  // ═══════════════════════════════════════════════════════
  // 👈 Time display — weekly HH:MM:SS, regular Xs
  // ═══════════════════════════════════════════════════════
  let timeStr = "…";
  if (countdown !== null && countdown > 0) {
    timeStr = isWeeklyRoom
      ? formatHHMMSS(countdown)
      : formatSecondsOnly(countdown);
  } else if (countdown === 0) {
    timeStr = isWeeklyRoom ? "00:00:00" : "0s";
  }

  const isUrgent = countdown !== null && countdown <= 10 && countdown > 0;
  const timeColor = isUrgent
    ? "#e74c3c"
    : isWeeklyRoom
    ? "#f39c12"
    : "#ffd43b";

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
        <InfoCell
          icon="💰"
          label="Wallet"
          value={currentBalance}
          color="#2ecc71"
        />
        <InfoCell icon="🎯" label="Stake" value={stake} color="#f39c12" />
        <InfoCell
          icon="🎴"
          label="Selected"
          value={selectedCards.length}
          color="#3498db"
        />
        <InfoCell
          icon="🕐"
          label="Time"
          value={timeStr}
          color={timeColor}
          size={isWeeklyRoom ? 12 : 15}
        />
      </div>

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
          maxHeight: "calc(100vh - 260px)",
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

function InfoCell({ icon, label, value, color = "#fff", size = 14 }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 12, marginBottom: 1 }}>{icon}</div>
      <div
        style={{
          color: "#888",
          fontSize: 8,
          marginBottom: 2,
          fontWeight: "bold",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontSize: size,
          fontWeight: "900",
          lineHeight: 1.2,
          fontFamily: "monospace",
          letterSpacing: 0.5,
          textShadow: `0 0 8px ${color}66`,
        }}
      >
        {value}
      </div>
    </div>
  );
}