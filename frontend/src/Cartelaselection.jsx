import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import { getRoom, getSocket, getBalance } from "./api";
import { formatCountdown, serverNow } from "./serverClock";

const TOTAL_CARDS = 1250;
const WEEKLY_ROOMS = ["ROOM50", "ROOM100"];
const SYNC_RETRIES = 6;

// ═══════════════════════════════════════════════════════
// ✅ Number button — memoized (1250 buttons ላይ ወሳኝ)
// ═══════════════════════════════════════════════════════
const NumberButton = memo(function NumberButton({
  n,
  isSelected,
  isTaken,
  onSelect,
}) {
  return (
    <button
      onClick={() => onSelect(n)}
      disabled={isTaken}
      style={{
        padding: "9px 0",
        borderRadius: 6,
        border: isSelected
          ? "2px solid #2ecc71"
          : isTaken
          ? "2px solid #e74c3c"
          : "1px solid #2a2a40",
        background: isTaken
          ? "linear-gradient(135deg, #e74c3c, #a93226)"
          : isSelected
          ? "linear-gradient(135deg, #2ecc71, #27ae60)"
          : "linear-gradient(135deg, #1b2233, #151b2b)",
        color: "#fff",
        fontWeight: "bold",
        fontSize: 10,
        cursor: isTaken ? "not-allowed" : "pointer",
        opacity: isTaken ? 0.9 : 1,
        boxShadow: isSelected
          ? "0 0 10px rgba(46,204,113,0.6)"
          : isTaken
          ? "0 0 12px rgba(231,76,60,0.9), inset 0 0 8px rgba(231,76,60,0.3)"
          : "none",
        transition: "all 0.2s ease",
      }}
    >
      {n}
    </button>
  );
});

// ═══════════════════════════════════════════════════════
// የካርቴላ መምረጫ ገጽ
// ═══════════════════════════════════════════════════════
export default function CartelaSelection({
  roomCode,
  balance,
  setBalance,
  stake = 10,
  onConfirm,
  onCancel,
  onGameStatusChange,
}) {
  const isWeeklyRoom = WEEKLY_ROOMS.includes(roomCode);

  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [deadlineMs, setDeadlineMs] = useState(null);
  const [remainingSec, setRemainingSec] = useState(null);
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [notice, setNotice] = useState("");

  const wentLiveRef = useRef(false);
  const selectedRef = useRef([]);
  const noticeTimerRef = useRef(null);
  const pollStopRef = useRef(false);
  const mountedRef = useRef(true);

  // ✅ FIX: ref ን በ render body ሳይሆን በ useEffect ያዘምኑ
  useEffect(() => {
    selectedRef.current = selectedCards;
  }, [selectedCards]);

  // Refs ለ handleSelect
  const takenRef = useRef([]);
  const balanceRef = useRef(balance);
  useEffect(() => {
    takenRef.current = takenCards;
  }, [takenCards]);
  useEffect(() => {
    balanceRef.current = currentBalance;
  }, [currentBalance]);

  // ───────────── Mount / Unmount ─────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(noticeTimerRef.current);
      pollStopRef.current = true;
    };
  }, []);

  const flash = useCallback((msg) => {
    if (!mountedRef.current) return;
    setNotice(msg);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setNotice("");
    }, 2500);
  }, []);

  // ───────────── ወደ ላይቭ ጌም ─────────────
  const goLive = useCallback(() => {
    if (wentLiveRef.current) return;
    wentLiveRef.current = true;
    onGameStatusChange?.("active");
    onConfirm([]);
  }, [onConfirm, onGameStatusChange]);

  // ───────────── የሰርቨር ሁኔታን ወደ state ተግብር ─────────────
  const applyRoomState = useCallback(
    (s) => {
      if (!s || (s.roomCode && s.roomCode !== roomCode)) return;

      if (s.status === "active") return goLive();

      if (Array.isArray(s.takenCards)) {
        setTakenCards(s.takenCards);
      }

      if (s.status === "waiting") {
        let t = s.selectionEndsAt ? new Date(s.selectionEndsAt).getTime() : null;
        
        // ✅ FIX: ሰርቨሩ ሰዓት ካልላከ 50 ሰከንድ የአካባቢ ሰዓት እንጀምር (እንዳይቆም)
        if (!t && !s.isWeeklyGame) {
          t = Date.now() + 50000; 
        }
        
        if (t && Number.isFinite(t)) {
          setDeadlineMs(t);
        }
      }
    },
    [roomCode, goLive]
  );

  // ───────────── ክፍል ሲቀየር ዳግም አስጀምር ─────────────
  useEffect(() => {
    wentLiveRef.current = false;
    pollStopRef.current = false;
    setSelectedCards([]);
    setTakenCards([]);
    setDeadlineMs(null);
    setRemainingSec(null);
  }, [roomCode]);

  // ───────────── የመጀመሪያ ማመሳሰል (REST) + ባላንስ ─────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      for (let attempt = 0; attempt < SYNC_RETRIES && !cancelled; attempt++) {
        try {
          const data = await getRoom(roomCode, attempt === 0 ? 3000 : 2000);
          if (!cancelled) applyRoomState(data);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (!cancelled) flash("ግንኙነት የለም — እንደገና እየሞከረ ነው");
    })();

    (async () => {
      try {
        const d = await getBalance();
        if (!cancelled && d?.balance !== undefined) {
          setCurrentBalance(d.balance);
          if (setBalance) setBalance(d.balance); // ✅ ዋናው አፕ ሲነሳ ባላንስን አዛምን
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [roomCode, applyRoomState, flash, setBalance]);

  // ───────────── Socket ─────────────
  useEffect(() => {
    const s = getSocket();
    const watch = () => s.emit("watch_room", { roomCode });

    const onRoomState = (st) => applyRoomState(st);

    const onGameStarted = (d) => {
      if (!d.roomCode || d.roomCode === roomCode) goLive();
    };

    const onCardsTaken = ({ cardIds }) => {
      if (!Array.isArray(cardIds)) return;
      setTakenCards((p) => {
        const set = new Set(p);
        for (const id of cardIds) set.add(id);
        return [...set];
      });
    };

    const onCardReleased = ({ cardId }) => {
      if (typeof cardId !== "number") return;
      setTakenCards((p) => p.filter((x) => x !== cardId));
    };

    // ✅ ሰርቨር ባላንስ ሲመልስ ሁለቱንም ስቴቶች ማዘመን
    const onBal = ({ balance: b }) => {
      setCurrentBalance(b);
      if (setBalance) setBalance(b);
    };

    const onMine = ({ roomCode: rc, cardIds }) => {
      if (rc === roomCode && Array.isArray(cardIds)) {
        setSelectedCards(cardIds);
        setTakenCards((p) => {
          const set = new Set(p);
          for (const id of cardIds) set.add(id);
          return [...set];
        });
      }
    };

    const onErr = ({ message, cardId }) => {
      flash(message || "ስህተት");
      if (cardId) setSelectedCards((p) => p.filter((x) => x !== cardId));
    };

    s.on("connect", watch);
    s.on("room_state", onRoomState);
    s.on("game_started", onGameStarted);
    s.on("cards_taken", onCardsTaken);
    s.on("card_released", onCardReleased);
    s.on("balance_update", onBal);
    s.on("my_reservations", onMine);
    s.on("error_message", onErr);
    if (s.connected) watch();

    return () => {
      s.off("connect", watch);
      s.off("room_state", onRoomState);
      s.off("game_started", onGameStarted);
      s.off("cards_taken", onCardsTaken);
      s.off("card_released", onCardReleased);
      s.off("balance_update", onBal);
      s.off("my_reservations", onMine);
      s.off("error_message", onErr);
      clearTimeout(noticeTimerRef.current);
    };
  }, [roomCode, applyRoomState, goLive, flash, setBalance]);

  // ───────────── ቆጣሪ ─────────────
  useEffect(() => {
    if (!deadlineMs) return;
    const tick = () => {
      const ms = deadlineMs - serverNow();
      setRemainingSec(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadlineMs]);

  // ───────────── ሰዓቱ 0 ወይም ባዶ ሲሆን → ሰርቨርን ጠይቅ ─────────────
  useEffect(() => {
    if (remainingSec !== 0 && remainingSec !== null) return; // ✅ ማሻሻያ
    if (wentLiveRef.current) return;
    pollStopRef.current = false;

    const poll = async () => {
      for (let i = 0; i < 20; i++) {
        if (pollStopRef.current || wentLiveRef.current) return;
        try {
          const data = await getRoom(roomCode, 1500);
          applyRoomState(data);
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    const first = setTimeout(poll, 800);
    return () => {
      pollStopRef.current = true;
      clearTimeout(first);
    };
  }, [remainingSec, roomCode, applyRoomState]);

  // ═══════════════════════════════════════════════════
  // handleSelect — Optimistic UI (ወዲያውኑ ባላንስ እንዲቀየር)
  // ═══════════════════════════════════════════════════
  const handleSelect = useCallback(
    (id) => {
      if (wentLiveRef.current) return;
      const selected = selectedRef.current;
      const taken = takenRef.current;

      const isMine = selected.includes(id);
      const isTakenByOther = taken.includes(id) && !isMine;

      if (isTakenByOther) return;

      if (isMine) {
        // ካርቴላ ሲያስወግዱ
        getSocket().emit("deselect_card", { roomCode, cardId: id });
        setSelectedCards((p) => p.filter((x) => x !== id));
        
        // ✅ ወዲያውኑ ባላንሱን ወደ ነበረበት መመለስ
        const newBal = balanceRef.current + stake;
        balanceRef.current = newBal;
        setCurrentBalance(newBal);
        if (setBalance) setBalance(newBal);
        return;
      }

      if (balanceRef.current < stake) {
        return flash(`❌ ቀሪ ሂሳብ በቂ አይደለም — ${stake} ETB ያስፈልጋል`);
      }

      // ካርቴላ ሲመርጡ
      getSocket().emit("select_card", { roomCode, cardId: id });
      setSelectedCards((p) => [...p, id]);
      
      // ✅ ወዲያውኑ ባላንሱን መቀነስ
      const newBal = balanceRef.current - stake;
      balanceRef.current = newBal;
      setCurrentBalance(newBal);
      if (setBalance) setBalance(newBal);
    },
    [roomCode, stake, flash, setBalance]
  );

  // ───────────── Back ─────────────
  const handleCancel = () => {
    pollStopRef.current = true;
    const s = getSocket();
    if (!wentLiveRef.current) {
      // ✅ ካርቴላዎችን መርጠው ወደ ኋላ ከተመለሱ ብሩ ወዲያውኑ እንዲመለስ
      const refundAmount = selectedRef.current.length * stake;
      if (refundAmount > 0 && setBalance) {
        setBalance(balanceRef.current + refundAmount);
      }

      for (const id of selectedRef.current) {
        s.emit("deselect_card", { roomCode, cardId: id });
      }
      setTimeout(() => {
        s.emit("leave_room");
        onCancel?.();
      }, 150);
    } else {
      s.emit("leave_room");
      onCancel?.();
    }
  };

  const numbers = useMemo(
    () => Array.from({ length: TOTAL_CARDS }, (_, i) => i + 1),
    []
  );

  const selectedSet = useMemo(() => new Set(selectedCards), [selectedCards]);
  const takenSet = useMemo(() => new Set(takenCards), [takenCards]);

  const total = selectedCards.length * stake;
  const maxAffordable = Math.floor(currentBalance / stake);

  const timeStr =
    remainingSec === null ? "⏳" : formatCountdown(remainingSec, isWeeklyRoom);
  const isUrgent =
    remainingSec !== null && remainingSec <= 10 && remainingSec > 0;
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
        onClick={handleCancel}
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
          CHOOSE CARTELA
        </div>

        {notice && (
          <div
            style={{
              color: "#e74c3c",
              fontSize: 10,
              fontWeight: "bold",
              letterSpacing: 2,
              marginTop: 2,
            }}
          >
            {notice}
          </div>
        )}
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
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
          background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
          border: "1px solid #2a2a40",
          borderRadius: 10,
          padding: "8px 10px",
          marginBottom: 8,
          fontSize: 11,
          fontWeight: "bold",
          textAlign: "center",
        }}
      >
        <span>
          Selected:{" "}
          <b style={{ color: "#2ecc71" }}>{selectedCards.length}</b>
        </span>
        <span>
          Total: <b style={{ color: "#f39c12" }}>{total} ETB</b>
        </span>
        <span>
          Max: <b style={{ color: "#3498db" }}>{maxAffordable}</b>
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
          maxHeight: "calc(100vh - 300px)",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {numbers.map((n) => {
          const isSelected = selectedSet.has(n);
          const isTaken = !isSelected && takenSet.has(n);

          return (
            <NumberButton
              key={n}
              n={n}
              isSelected={isSelected}
              isTaken={isTaken}
              onSelect={handleSelect}
            />
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