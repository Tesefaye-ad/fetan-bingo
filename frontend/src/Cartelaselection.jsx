import { useCallback, useEffect, useRef, useState } from "react";
import { getRoom, getSocket } from "./api";
import { formatCountdown, serverNow } from "./serverClock";

const TOTAL_CARDS = 1250;
const MAX_CARDS = 3; // አንድ ተጠቃሚ ቢበዛ 3 ካርቴላ
const WEEKLY_ROOMS = ["ROOM50", "ROOM100"];
const SYNC_RETRIES = 8;

// ═══════════════════════════════════════════════════════
// የካርቴላ መምረጫ ገጽ
//  • ሰዓቱ ከሰርቨር absolute ሰዓት (selectionEndsAt) ይሰላል → ለሁሉም ተመሳሳይ
//  • ሰዓቱ ሲያልቅ ጨዋታውን የሚጀምረው ሰርቨር ነው (game_started) — ክላይንቱ ዝም ብሎ ይከተላል
//  • ካርቴላ ያልመረጠ ሰው ያለ ክፍያ ተመልካች ሆኖ ወደ ላይቭ ጌም ይገባል
//  • ጨዋታው አስቀድሞ ላይቭ ከሆነ ወዲያውኑ ወደ ላይቭ ጌም ይሄዳል
// ═══════════════════════════════════════════════════════
export default function CartelaSelection({
  roomCode,
  balance,
  stake = 10,
  onConfirm,
  onCancel,
  onGameStatusChange,
}) {
  const isWeeklyRoom = WEEKLY_ROOMS.includes(roomCode);

  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [deadlineMs, setDeadlineMs] = useState(null); // የሰርቨር absolute ሰዓት (ms)
  const [remainingSec, setRemainingSec] = useState(null);
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [notice, setNotice] = useState("");

  const wentLiveRef = useRef(false);
  const selectedRef = useRef([]);
  const noticeTimerRef = useRef(null);
  selectedRef.current = selectedCards;

  const flash = useCallback((msg) => {
    setNotice(msg);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 2500);
  }, []);

  // ወደ ላይቭ ጌም — አንድ ጊዜ ብቻ
  const goLive = useCallback(() => {
    if (wentLiveRef.current) return;
    wentLiveRef.current = true;
    onGameStatusChange?.("active");
    onConfirm([]); // ካርዶቹ በሰርቨሩ ተይዘዋል — ሰርቨሩ ራሱ ይልካቸዋል
  }, [onConfirm, onGameStatusChange]);

  // የሰርቨር ሁኔታን ወደ state ተግብር
  const applyRoomState = useCallback(
    (s) => {
      if (!s || (s.roomCode && s.roomCode !== roomCode)) return;
      if (s.status === "active") return goLive();
      if (Array.isArray(s.takenCards) || Array.isArray(s.reservedCards)) {
        setTakenCards([...new Set([...(s.takenCards || []), ...(s.reservedCards || [])])]);
      }
      if (s.status === "waiting" && s.selectionEndsAt) {
        const t = new Date(s.selectionEndsAt).getTime();
        if (Number.isFinite(t)) setDeadlineMs(t);
      }
    },
    [roomCode, goLive]
  );

  // ───────────── ክፍል ሲቀየር ዳግም አስጀምር ─────────────
  useEffect(() => {
    wentLiveRef.current = false;
    setSelectedCards([]);
    setTakenCards([]);
    setDeadlineMs(null);
    setRemainingSec(null);
  }, [roomCode]);

  // ───────────── የመጀመሪያ ማመሳሰል (REST) ─────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < SYNC_RETRIES && !cancelled; attempt++) {
        try {
          const data = await getRoom(roomCode, attempt === 0 ? 2500 : 2000);
          if (!cancelled) applyRoomState(data);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      if (!cancelled) flash("ግንኙነት የለም — እንደገና እየሞከረ ነው");
    })();

    (async () => {
      try {
        const token = localStorage.getItem("bingo_token");
        const base = process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";
        const r = await fetch(`${base}/api/wallet/balance`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        if (!cancelled && d.balance !== undefined) setCurrentBalance(d.balance);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode, applyRoomState, flash]);

  // ───────────── Socket ─────────────
  useEffect(() => {
    const s = getSocket();
    const watch = () => s.emit("watch_room", { roomCode });

    const onRoomState = (st) => applyRoomState(st);
    const onGameStarted = (d) => {
      if (!d.roomCode || d.roomCode === roomCode) goLive();
    };
    const onSel = ({ cardId }) => setTakenCards((p) => [...new Set([...p, cardId])]);
    const onDesel = ({ cardId }) => setTakenCards((p) => p.filter((x) => x !== cardId));
    const onBal = ({ balance: b }) => setCurrentBalance(b);
    const onMine = ({ roomCode: rc, cardIds }) => {
      if (rc === roomCode && Array.isArray(cardIds)) {
        setSelectedCards(cardIds);
        setTakenCards((p) => [...new Set([...p, ...cardIds])]);
      }
    };
    const onErr = ({ message, cardId }) => {
      flash(message || "ስህተት");
      if (cardId) setSelectedCards((p) => p.filter((x) => x !== cardId)); // optimistic ምርጫን መልስ
    };

    s.on("connect", watch);
    s.on("room_state", onRoomState);
    s.on("game_started", onGameStarted);
    s.on("card_selected", onSel);
    s.on("card_deselected", onDesel);
    s.on("balance_update", onBal);
    s.on("my_reservations", onMine);
    s.on("error_message", onErr);
    if (s.connected) watch();

    return () => {
      s.off("connect", watch);
      s.off("room_state", onRoomState);
      s.off("game_started", onGameStarted);
      s.off("card_selected", onSel);
      s.off("card_deselected", onDesel);
      s.off("balance_update", onBal);
      s.off("my_reservations", onMine);
      s.off("error_message", onErr);
      clearTimeout(noticeTimerRef.current);
    };
  }, [roomCode, applyRoomState, goLive, flash]);

  // ───────────── ቆጣሪ: በየ 100ms ከሰርቨር ሰዓት ይሰላል ─────────────
  useEffect(() => {
    if (!deadlineMs) return;
    const tick = () => {
      const ms = deadlineMs - serverNow();
      setRemainingSec(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [deadlineMs]);

  // ───────────── ሰዓቱ 0 ሲደርስ ሰርቨሩ game_started እስኪልክ ይጠብቃል.
  // ሶኬቱ ቢያመልጥ እንኳን በ REST ይጠይቃል (ወይም ባዶ ዙር ከሆነ አዲሱን ሰዓት ይወስዳል) ─────────────
  useEffect(() => {
    if (remainingSec !== 0 || wentLiveRef.current) return;
    let stop = false;
    const poll = async () => {
      for (let i = 0; i < 20 && !stop && !wentLiveRef.current; i++) {
        try {
          applyRoomState(await getRoom(roomCode, 1500));
        } catch {}
        await new Promise((r) => setTimeout(r, 400));
      }
    };
    const first = setTimeout(poll, 600); // ለሶኬቱ ጊዜ ስጠው
    return () => {
      stop = true;
      clearTimeout(first);
    };
  }, [remainingSec, roomCode, applyRoomState]);

  // ───────────── ካርቴላ መምረጥ / መመለስ ─────────────
  const handleSelect = (id) => {
    if (wentLiveRef.current || remainingSec === 0) return;
    const isMine = selectedCards.includes(id);
    if (takenCards.includes(id) && !isMine) return;

    if (isMine) {
      getSocket().emit("deselect_card", { roomCode, cardId: id });
      setSelectedCards((p) => p.filter((x) => x !== id));
      return;
    }
    if (selectedCards.length >= MAX_CARDS) return flash(`ቢበዛ ${MAX_CARDS} ካርቴላ ብቻ`);
    if (currentBalance < stake) return flash("❌ ቀሪ ሂሳብ በቂ አይደለም");
    getSocket().emit("select_card", { roomCode, cardId: id });
    setSelectedCards((p) => [...p, id]);
  };

  // Back → ገንዘቡ ይመለስ (ጨዋታው ገና ካልጀመረ)
  const handleCancel = () => {
    if (!wentLiveRef.current) {
      for (const id of selectedRef.current) {
        getSocket().emit("deselect_card", { roomCode, cardId: id });
      }
    }
    getSocket().emit("leave_room");
    onCancel?.();
  };

  const numbers = Array.from({ length: TOTAL_CARDS }, (_, i) => i + 1);
  const total = selectedCards.length * stake;

  // ═══════════════════════════════════════════════════
  // Display
  // ═══════════════════════════════════════════════════
  const timeStr =
    remainingSec === null ? "…" : formatCountdown(remainingSec, isWeeklyRoom);
  const isUrgent = remainingSec !== null && remainingSec <= 10 && remainingSec > 0;
  const timeColor = isUrgent ? "#e74c3c" : isWeeklyRoom ? "#f39c12" : "#ffd43b";

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
          {remainingSec === null && " • syncing…"}
          {notice && <span style={{ color: "#e74c3c" }}> • {notice}</span>}
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