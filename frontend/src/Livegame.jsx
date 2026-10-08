import { useEffect, useRef, useState } from "react";
import { getSocket } from "./api";

const HEADERS = [
  { letter: "B", color: "#4c6ef5" },
  { letter: "I", color: "#9c27b0" },
  { letter: "N", color: "#e91e63" },
  { letter: "G", color: "#4caf50" },
  { letter: "O", color: "#ff9800" },
];

const PATTERN_LABELS = {
  "any-row": "Any Row",
  "any-column": "Any Column",
  "any-diagonal": "Diagonal",
  "four-corners": "4 Corners",
  "full-card": "Full Card",
};

const PATTERN_ICONS = {
  "any-row": "➡️",
  "any-column": "⬇️",
  "any-diagonal": "↘️",
  "four-corners": "🔲",
  "full-card": "🟩",
};

function getLetter(num) {
  if (num <= 15) return { letter: "B", color: "#4c6ef5" };
  if (num <= 30) return { letter: "I", color: "#9c27b0" };
  if (num <= 45) return { letter: "N", color: "#e91e63" };
  if (num <= 60) return { letter: "G", color: "#4caf50" };
  return { letter: "O", color: "#ff9800" };
}

function buildBoard() {
  const out = [];
  for (let r = 0; r < 15; r++)
    for (let c = 0; c < 5; c++) out.push(c * 15 + r + 1);
  return out;
}

// ═══════════════════════════════════════════════════════
// PATTERN PREVIEW
// ═══════════════════════════════════════════════════════
function PatternPreview({ pattern, size = 70 }) {
  const getHighlightedCells = () => {
    const cells = new Set();
    const key = (r, c) => `${r}-${c}`;
    switch (pattern) {
      case "any-row":
        for (let c = 0; c < 5; c++) cells.add(key(2, c));
        break;
      case "any-column":
        for (let r = 0; r < 5; r++) cells.add(key(r, 2));
        break;
      case "any-diagonal":
        for (let i = 0; i < 5; i++) {
          cells.add(key(i, i));
          cells.add(key(i, 4 - i));
        }
        break;
      case "four-corners":
        cells.add(key(0, 0));
        cells.add(key(0, 4));
        cells.add(key(4, 0));
        cells.add(key(4, 4));
        break;
      case "full-card":
        for (let r = 0; r < 5; r++)
          for (let c = 0; c < 5; c++) cells.add(key(r, c));
        break;
      default:
        break;
    }
    return cells;
  };

  const highlighted = getHighlightedCells();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 2,
        width: "100%",
        maxWidth: size,
        margin: "0 auto",
      }}
    >
      {Array.from({ length: 25 }, (_, i) => {
        const r = Math.floor(i / 5);
        const c = i % 5;
        const isHighlighted = highlighted.has(`${r}-${c}`);
        return (
          <div
            key={i}
            style={{
              aspectRatio: 1,
              borderRadius: 2,
              background: isHighlighted
                ? "linear-gradient(135deg, #f39c12, #ffd43b)"
                : "#252d44",
              border: isHighlighted
                ? "1px solid #ffd43b"
                : "1px solid #2a2a40",
              boxShadow: isHighlighted
                ? "0 0 5px rgba(243,156,18,0.9)"
                : "none",
            }}
          />
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// CONFETTI
// ═══════════════════════════════════════════════════════
function Confetti() {
  const pieces = Array.from({ length: 40 }, (_, i) => i);
  const colors = ["#f39c12", "#2ecc71", "#3498db", "#e74c3c", "#9c27b0"];
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 999,
        overflow: "hidden",
      }}
    >
      {pieces.map((i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 2;
        const duration = 2 + Math.random() * 2;
        const color = colors[i % colors.length];
        const size = 5 + Math.random() * 6;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: "-20px",
              left: `${left}%`,
              width: size,
              height: size,
              background: color,
              borderRadius: Math.random() > 0.5 ? "50%" : "2px",
              animation: `confettiFall ${duration}s linear ${delay}s infinite`,
            }}
          />
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SOUND
// ═══════════════════════════════════════════════════════
const sound = {
  ctx: null,
  enabled: true,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.enabled = false;
    }
  },
  play(freq, duration = 150, type = "sine", volume = 0.15) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      if (this.ctx.state === "suspended") this.ctx.resume();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = freq;
      osc.type = type;
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.01,
        this.ctx.currentTime + duration / 1000
      );
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration / 1000);
    } catch (e) {}
  },
  callNumber(num) {
    if (!num) {
      this.play(880, 120, "sine", 0.2);
      return;
    }
    const { letter } = getLetter(num);
    const freq = { B: 450, I: 600, N: 750, G: 900, O: 1050 }[letter] || 880;
    this.play(freq, 130, "sine", 0.22);
    setTimeout(() => this.play(freq + 100, 130, "sine", 0.18), 140);
  },
  bingo() {
    this.play(523, 200, "triangle", 0.28);
    setTimeout(() => this.play(659, 200, "triangle", 0.28), 180);
    setTimeout(() => this.play(784, 200, "triangle", 0.28), 360);
    setTimeout(() => this.play(1046, 500, "triangle", 0.32), 540);
  },
  tick() {
    this.play(600, 60, "square", 0.08);
  },
};

// ═══════════════════════════════════════════════════════
// 75-NUMBER TRACKER — B I N G O ብቻ
// ═══════════════════════════════════════════════════════
function NumberTracker({ calledNumbers, lastNumber }) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
        border: "1px solid #2a2a40",
        borderRadius: 10,
        padding: 5,
      }}
    >
      {/* 👈 B I N G O — ፊደል ብቻ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 2,
          marginBottom: 4,
        }}
      >
        {HEADERS.map((h) => (
          <div
            key={h.letter}
            style={{
              background: `linear-gradient(135deg, ${h.color}, ${h.color}cc)`,
              color: "#fff",
              textAlign: "center",
              fontWeight: "bold",
              borderRadius: 5,
              padding: "5px 0",
              boxShadow: `0 0 8px ${h.color}66`,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            {h.letter}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 2,
        }}
      >
        {buildBoard().map((n) => {
          const info = getLetter(n);
          const called = calledNumbers.includes(n);
          const isLast = lastNumber === n;
          return (
            <div
              key={n}
              style={{
                aspectRatio: 1,
                background: isLast
                  ? "linear-gradient(135deg, #ff9800, #f39c12)"
                  : called
                  ? `linear-gradient(135deg, ${info.color}, ${info.color}cc)`
                  : "linear-gradient(135deg, #252d44, #1b2233)",
                color: "#fff",
                fontSize: 10,
                fontWeight: "bold",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: isLast
                  ? "2px solid #ffd43b"
                  : "1px solid #2a2a40",
                animation: isLast ? "cellFlash 0.6s ease-out" : "none",
                boxShadow: isLast
                  ? "0 0 10px rgba(255,152,0,0.9)"
                  : called
                  ? `0 0 4px ${info.color}66`
                  : "none",
                transition: "all 0.3s",
              }}
            >
              {n}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// USER CARD
// ═══════════════════════════════════════════════════════
function UserCard({ card, marked, cardId, lastNumber, cardCount = 1 }) {
  const sizes = {
    1: { fontSize: 12, gap: 3 },
    2: { fontSize: 10, gap: 2 },
    3: { fontSize: 8, gap: 1.5 },
  };
  const sz = sizes[cardCount] || sizes[3];

  const markedCount = marked?.flat().filter(Boolean).length || 0;
  const progress = Math.round((markedCount / 25) * 100);
  const isHot = progress >= 60;

  return (
    <div
      style={{
        marginBottom: 6,
        padding: 3,
        background: isHot
          ? "linear-gradient(135deg, rgba(46,204,113,0.1), rgba(15,20,32,0.6))"
          : "linear-gradient(135deg, rgba(52,152,219,0.06), rgba(15,20,32,0.6))",
        border: `1px solid ${isHot ? "#2ecc71" : "rgba(52,152,219,0.3)"}`,
        borderRadius: 8,
        boxShadow: isHot ? "0 0 10px rgba(46,204,113,0.4)" : "none",
        transition: "all 0.3s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 3,
        }}
      >
        <div
          style={{
            color: isHot ? "#2ecc71" : "#f39c12",
            fontSize: 9,
            fontWeight: "900",
            letterSpacing: 0.5,
          }}
        >
          🎴 #{cardId}
          {isHot && <span style={{ marginLeft: 3 }}>🔥</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <div
            style={{
              width: 30,
              height: 3,
              background: "#252d44",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                background: isHot
                  ? "linear-gradient(90deg, #2ecc71, #27ae60)"
                  : "linear-gradient(90deg, #3498db, #2980b9)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div
            style={{
              color: isHot ? "#2ecc71" : "#888",
              fontSize: 8,
              fontWeight: "bold",
              minWidth: 20,
              textAlign: "right",
            }}
          >
            {progress}%
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: sz.gap,
        }}
      >
        {card.map((row, r) =>
          row.map((v, c) => {
            const m = marked?.[r]?.[c];
            const free = r === 2 && c === 2;
            const isLast = !free && lastNumber === v;
            return (
              <div
                key={`${r}-${c}`}
                style={{
                  aspectRatio: 1,
                  fontSize: sz.fontSize,
                  fontWeight: "bold",
                  borderRadius: 3,
                  background: free
                    ? "linear-gradient(135deg, #ffd43b, #f39c12)"
                    : isLast
                    ? "linear-gradient(135deg, #ff9800, #f39c12)"
                    : m
                    ? "linear-gradient(135deg, #4caf50, #2ecc71)"
                    : "linear-gradient(135deg, #252d44, #1b2233)",
                  color: free ? "#1b2233" : "#fff",
                  border: isLast
                    ? "2px solid #ffd43b"
                    : "1px solid #2a2a40",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.3s",
                  animation: isLast ? "cellFlash 0.6s ease-out" : "none",
                  boxShadow: isLast
                    ? "0 0 12px rgba(255,152,0,0.8)"
                    : m
                    ? "0 0 6px rgba(76,175,80,0.4)"
                    : "none",
                }}
              >
                {free ? "★" : v}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN LIVE GAME
// ═══════════════════════════════════════════════════════
export default function LiveGame({
  roomCode,
  cardIds,
  onExit,
  onGameEnded,
  setBalance,
}) {
  const socketRef = useRef(null);
  const joinedRef = useRef(false);
  const soundOnRef = useRef(true);
  const cardsReceivedRef = useRef(false);
  const retryTimerRef = useRef(null);

  const [cards, setCards] = useState([]);
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastNumber, setLastNumber] = useState(null);
  const [lastLetter, setLastLetter] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [prizePool, setPrizePool] = useState(0);
  const [entryFee, setEntryFee] = useState(0);
  const [winPattern, setWinPattern] = useState("any-row");
  const [flashNumber, setFlashNumber] = useState(false);
  const [bingoPopup, setBingoPopup] = useState(null);
  const [soundOn, setSoundOn] = useState(true);
  const [numberAnimKey, setNumberAnimKey] = useState(0);
  const [isSpectator, setIsSpectator] = useState(false);
  const endedRef = useRef(false);
  const popupTimerRef = useRef(null);
  const fallbackTimerRef = useRef(null);

  useEffect(() => {
    soundOnRef.current = soundOn;
    sound.enabled = soundOn;
  }, [soundOn]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const emitJoin = (reason = "initial") => {
      if (!socket.connected) return;
      if (cardsReceivedRef.current) return;
      socket.emit("join_room", { roomCode });
    };

    const onConnect = () => {
      cardsReceivedRef.current = false;
      emitJoin("reconnect");
    };

    const onStateRestore = (data) => {
      cardsReceivedRef.current = true;
      setIsSpectator(false);
      setCalledNumbers(data.calledNumbers || []);
      setWinPattern(data.winPattern || "any-row");
      setPrizePool(data.prizePool || 0);
      setPlayerCount(data.playerCount || 0);
      setEntryFee(data.entryFee || 0);
      if (data.cards?.length) {
        setCards(
          data.cards.map((c, i) => ({
            cardId: c.cardId || i + 1,
            card: c.card,
            marked: c.marked,
          }))
        );
      }
      if (data.calledNumbers?.length) {
        const last = data.calledNumbers[data.calledNumbers.length - 1];
        setLastNumber(last);
        setLastLetter(getLetter(last).letter);
      }
    };

    const onSpectatorMode = (data) => {
      cardsReceivedRef.current = true;
      setIsSpectator(true);
      setCalledNumbers(data.calledNumbers || []);
      setWinPattern(data.winPattern || "any-row");
      setPrizePool(data.prizePool || 0);
      setPlayerCount(data.playerCount || 0);
      setEntryFee(data.entryFee || 0);
      if (data.calledNumbers?.length) {
        const last = data.calledNumbers[data.calledNumbers.length - 1];
        setLastNumber(last);
        setLastLetter(getLetter(last).letter);
      }
    };

    const onYourCards = (d) => {
      if (!d.cards) return;
      cardsReceivedRef.current = true;
      setIsSpectator(false);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setCards(
        d.cards.map((card, i) => ({
          cardId: d.cardIds?.[i] || i + 1,
          card,
          marked: d.markedCards[i],
        }))
      );
    };

    const onRoomState = (s) => {
      setPlayerCount(s.playerCount);
      setPrizePool(s.prizePool);
      setEntryFee(s.entryFee || 0);
      setCalledNumbers((prev) =>
        (s.calledNumbers?.length || 0) >= prev.length
          ? s.calledNumbers || []
          : prev
      );
      if (s.winPattern) setWinPattern(s.winPattern);
    };

    const onGameStarted = (data) => {
      endedRef.current = false;
      setBingoPopup(null);
      setCalledNumbers([]);
      setLastNumber(null);
      setLastLetter(null);
      if (data.winPattern) setWinPattern(data.winPattern);
      if (data.prizePool !== undefined) setPrizePool(data.prizePool);
      if (data.playerCount !== undefined) setPlayerCount(data.playerCount);
      if (data.entryFee) setEntryFee(data.entryFee);
    };

    const onNumberCalled = ({
      number,
      letter,
      calledNumbers: cn,
      winPattern: wp,
    }) => {
      setLastNumber(number);
      setLastLetter(letter || getLetter(number).letter);
      setCalledNumbers(cn);
      if (wp) setWinPattern(wp);
      setNumberAnimKey((k) => k + 1);
      if (soundOnRef.current) sound.callNumber(number);
      setFlashNumber(true);
      setTimeout(() => setFlashNumber(false), 600);
      setCards((prev) =>
        prev.map((ci) => {
          const m = ci.marked.map((r) => [...r]);
          for (let r = 0; r < 5; r++)
            for (let c = 0; c < 5; c++)
              if (ci.card[r][c] === number) m[r][c] = true;
          return { ...ci, marked: m };
        })
      );
      if (window.navigator.vibrate) window.navigator.vibrate(80);
    };

    const returnToSelection = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearTimeout(popupTimerRef.current);
      clearTimeout(fallbackTimerRef.current);
      setBingoPopup(null);
      if (onGameEnded) onGameEnded();
      else onExit();
    };

    const onBingoClaimed = (data) => {
      setBingoPopup(data);
      const showMs = Math.max(500, Number(data.displayMs) || 5000);
      clearTimeout(popupTimerRef.current);
      popupTimerRef.current = setTimeout(() => setBingoPopup(null), showMs);
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = setTimeout(returnToSelection, showMs + 3000);
      if (data.winPattern) setWinPattern(data.winPattern);
      if (soundOnRef.current) sound.bingo();
      if (window.navigator.vibrate)
        window.navigator.vibrate([100, 50, 100, 50, 200]);
    };

    const onGameOver = () => returnToSelection();

    const onNextGameReady = () => {
      setBingoPopup(null);
      setLastNumber(null);
      setLastLetter(null);
      setCalledNumbers([]);
    };

    const onBalanceUpdate = ({ balance: b }) => setBalance(b);
    const onErrorMessage = ({ message }) => console.warn("[LiveGame]", message);

    socket.on("connect", onConnect);
    socket.on("state_restore", onStateRestore);
    socket.on("spectator_mode", onSpectatorMode);
    socket.on("your_cards", onYourCards);
    socket.on("room_state", onRoomState);
    socket.on("game_started", onGameStarted);
    socket.on("number_called", onNumberCalled);
    socket.on("bingo_claimed", onBingoClaimed);
    socket.on("game_over", onGameOver);
    socket.on("next_game_ready", onNextGameReady);
    socket.on("balance_update", onBalanceUpdate);
    socket.on("error_message", onErrorMessage);

    if (!joinedRef.current) {
      joinedRef.current = true;
      cardsReceivedRef.current = false;
      if (socket.connected) emitJoin("initial");
      else socket.once("connect", () => emitJoin("onconnect"));
      retryTimerRef.current = setTimeout(() => emitJoin("retry-1.5s"), 1500);
      setTimeout(() => emitJoin("retry-3s"), 3000);
      setTimeout(() => emitJoin("retry-5s"), 5000);
    }

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      clearTimeout(popupTimerRef.current);
      clearTimeout(fallbackTimerRef.current);
      socket.emit("leave_room");
      joinedRef.current = false;
      cardsReceivedRef.current = false;
      socket.off("connect", onConnect);
      socket.off("state_restore", onStateRestore);
      socket.off("spectator_mode", onSpectatorMode);
      socket.off("your_cards", onYourCards);
      socket.off("room_state", onRoomState);
      socket.off("game_started", onGameStarted);
      socket.off("number_called", onNumberCalled);
      socket.off("bingo_claimed", onBingoClaimed);
      socket.off("game_over", onGameOver);
      socket.off("next_game_ready", onNextGameReady);
      socket.off("balance_update", onBalanceUpdate);
      socket.off("error_message", onErrorMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, setBalance]);

  const lastInfo = lastNumber ? getLetter(lastNumber) : null;
  const cardCount = cards.length || 1;

  const animationStyles = `
    @keyframes popIn {
      0% { transform: scale(0); opacity: 0; }
      60% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(1); }
    }
    @keyframes bingoGlow {
      0%, 100% { text-shadow: 0 0 12px rgba(243,156,18,0.6); }
      50% { text-shadow: 0 0 25px rgba(243,156,18,1), 0 0 50px rgba(243,156,18,0.6); }
    }
    @keyframes confettiFall {
      0% { transform: translateY(0) rotate(0deg); opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }
    @keyframes cellFlash {
      0% { box-shadow: 0 0 0 0 rgba(255,152,0,0.9); }
      100% { box-shadow: 0 0 0 12px rgba(255,152,0,0); }
    }
    @keyframes numberBigPop {
      0% { transform: scale(0) rotate(-180deg); opacity: 0; filter: blur(10px); }
      40% { transform: scale(1.4) rotate(10deg); opacity: 1; filter: blur(0); }
      70% { transform: scale(1.1) rotate(-5deg); }
      100% { transform: scale(1) rotate(0deg); }
    }
    @keyframes ringRotate {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes ringPulse {
      0%, 100% { transform: scale(1); opacity: 0.5; }
      50% { transform: scale(1.2); opacity: 0.15; }
    }
  `;

  return (
    <>
      <style>{animationStyles}</style>
      <div
        style={{
          padding: 6,
          maxWidth: 480,
          margin: "0 auto",
          color: "#fff",
          height: "100vh",
          background: "linear-gradient(180deg, #0f1420 0%, #1a0f2e 100%)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          paddingBottom: 90,
        }}
      >
        {/* ═══ STATS — icon + label + value (Choose Cards style) ═══ */}
<div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    background:
      "linear-gradient(135deg, rgba(243,156,18,0.08), rgba(15,20,32,0.9))",
    border: "1px solid rgba(243,156,18,0.5)",
    borderRadius: 10,
    padding: "6px 4px",
    marginBottom: 6,
    flexShrink: 0,
    boxShadow: "0 0 12px rgba(243,156,18,0.15)",
  }}
>
  <Stat icon="🎮" label="Game" value={roomCode} color="#f39c12" size={11} />
  <Stat
    icon="👥"
    label="Players"
    value={playerCount}
    color="#3498db"
    size={14}
  />
  <Stat icon="🎯" label="Stake" value={entryFee} color="#e91e63" size={14} />
  <Stat icon="💰" label="Derash" value={prizePool} color="#2ecc71" size={14} />
  <Stat
    icon="📢"
    label="Called"
    value={calledNumbers.length}
    color="#ffd43b"
    size={14}
  />
</div>

        {/* MAIN 2-COLUMN */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* LEFT: 75-TRACKER */}
          <div
            style={{
              overflowY: "auto",
              minHeight: 0,
            }}
          >
            <NumberTracker
              calledNumbers={calledNumbers}
              lastNumber={lastNumber}
            />
          </div>

          {/* RIGHT COLUMN */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minHeight: 0,
            }}
          >
            {/* CURRENT — always visible */}
            <div
              style={{
                background: lastInfo
                  ? `linear-gradient(135deg, ${lastInfo.color}33 0%, #1a1a2e 40%, #0f1420 100%)`
                  : "linear-gradient(135deg, #1a1a2e, #0f1420)",
                border: flashNumber
                  ? `2px solid ${lastInfo?.color || "#ffd43b"}`
                  : "2px solid #f39c12",
                borderRadius: 12,
                padding: "8px 6px 6px",
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
                boxShadow: flashNumber
                  ? `0 0 25px ${lastInfo?.color || "#ffd43b"}99`
                  : `0 0 12px ${lastInfo?.color || "#f39c12"}55`,
                transition: "all 0.3s ease",
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setSoundOn((s) => !s)}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  background: soundOn
                    ? "linear-gradient(135deg, #2ecc71, #27ae60)"
                    : "#555",
                  color: "#fff",
                  border: "none",
                  borderRadius: 5,
                  padding: "2px 5px",
                  fontSize: 10,
                  fontWeight: "bold",
                  cursor: "pointer",
                  zIndex: 3,
                }}
              >
                {soundOn ? "🔊" : "🔇"}
              </button>

              <div
                style={{
                  color: lastInfo?.color || "#aaa",
                  fontSize: 7,
                  marginBottom: 3,
                  letterSpacing: 1.5,
                  fontWeight: "bold",
                }}
              >
              
              </div>

              {lastInfo ? (
                <div
                  style={{
                    position: "relative",
                    width: 64,
                    height: 64,
                    margin: "0 auto",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: -5,
                      borderRadius: "50%",
                      border: `2px solid ${lastInfo.color}`,
                      animation: "ringPulse 1.5s ease-in-out infinite",
                      pointerEvents: "none",
                    }}
                  />
                  <div
                    key={numberAnimKey}
                    style={{
                      position: "relative",
                      width: 64,
                      height: 64,
                      borderRadius: "50%",
                      background: `radial-gradient(circle at 30% 30%, #ffffff 0%, #fafafa 45%, ${lastInfo.color}33 100%)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "900",
                      color: lastInfo.color,
                      border: `3px solid ${lastInfo.color}`,
                      animation:
                        "numberBigPop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)",
                      boxShadow: `0 0 25px ${lastInfo.color}99`,
                      zIndex: 2,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        opacity: 0.85,
                        marginRight: 1,
                        fontWeight: "800",
                      }}
                    >
                      {lastLetter || lastInfo.letter}
                    </span>
                    <span
                      style={{
                        fontSize: 22,
                        fontWeight: "900",
                        lineHeight: 1,
                      }}
                    >
                      {lastNumber}
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    margin: "0 auto",
                    borderRadius: "50%",
                    background:
                      "radial-gradient(circle, #1a1a2e 0%, #0f1420 100%)",
                    border: "3px dashed #2a2a40",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#444",
                    fontSize: 18,
                    fontWeight: "bold",
                    animation: "ringPulse 2s ease-in-out infinite",
                  }}
                >
                  ?
                </div>
              )}

              <div
                style={{
                  marginTop: 5,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  background: `${lastInfo?.color || "#f39c12"}22`,
                  border: `1px solid ${lastInfo?.color || "#f39c12"}66`,
                  borderRadius: 20,
                  padding: "2px 9px",
                  fontSize: 9,
                  color: lastInfo?.color || "#f39c12",
                  fontWeight: "bold",
                }}
              >
                
              </div>
            </div>

            {/* SCROLLABLE: PATTERN + CARDS */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {/* PATTERN */}
              <div
                style={{
                  background:
                    "linear-gradient(135deg, #1a1a2e 0%, #0f1420 100%)",
                  border: "2px solid #f39c12",
                  borderRadius: 10,
                  padding: 5,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  boxShadow: "0 0 10px rgba(243,156,18,0.25)",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    color: "#f39c12",
                    fontSize: 8,
                    fontWeight: "bold",
                    letterSpacing: 1,
                  }}
                >
                  🏆 PATTERN
                </div>
                <PatternPreview pattern={winPattern} size={60} />
                <div
                  style={{
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: "bold",
                    textAlign: "center",
                  }}
                >
                  {PATTERN_LABELS[winPattern] || winPattern}
                </div>
              </div>

              {/* SPECTATOR NOTICE */}
              {isSpectator && cards.length === 0 && (
                <div
                  style={{
                    background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
                    border: "1px dashed #888",
                    borderRadius: 10,
                    padding: 8,
                    textAlign: "center",
                    color: "#bbb",
                    fontSize: 10,
                    fontWeight: "bold",
                    flexShrink: 0,
                  }}
                >
                  👀 እየተመለከቱ ነው
                  <div
                    style={{ color: "#888", fontSize: 9, marginTop: 3 }}
                  >
                    ቀጣዩ ዙር ካርቴላ መምረጥ ይችላሉ
                  </div>
                </div>
              )}

              {/* MY CARDS */}
              {cards.length > 0 && (
                <div
                  style={{
                    background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
                    border: `2px solid ${
                      cards.length > 1 ? "#f39c12" : "#3498db"
                    }`,
                    borderRadius: 10,
                    padding: 6,
                    boxShadow:
                      cards.length > 1
                        ? "0 0 12px rgba(243,156,18,0.3)"
                        : "0 0 12px rgba(52,152,219,0.3)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 6,
                      paddingBottom: 4,
                      borderBottom: "1px solid rgba(52,152,219,0.2)",
                    }}
                  >
                    <div
                      style={{
                        color: cards.length > 1 ? "#f39c12" : "#3498db",
                        fontSize: 10,
                        fontWeight: "bold",
                        letterSpacing: 1,
                      }}
                    >
                      🎴 MY CARTELA
                    </div>
                    <div
                      style={{
                        background:
                          cards.length > 1
                            ? "rgba(243,156,18,0.2)"
                            : "rgba(52,152,219,0.2)",
                        color: cards.length > 1 ? "#f39c12" : "#3498db",
                        border: `1px solid ${
                          cards.length > 1
                            ? "rgba(243,156,18,0.5)"
                            : "rgba(52,152,219,0.5)"
                        }`,
                        borderRadius: 20,
                        padding: "2px 8px",
                        fontSize: 10,
                        fontWeight: "bold",
                      }}
                    >
                      {cards.length} 
                    </div>
                  </div>

                  {cards.map((ci, idx) => (
                    <UserCard
                      key={idx}
                      card={ci.card}
                      marked={ci.marked}
                      cardId={ci.cardId}
                      lastNumber={lastNumber}
                      cardCount={cardCount}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* BOTTOM BAR */}
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            maxWidth: 480,
            margin: "0 auto",
            padding: "8px 12px",
            background: "linear-gradient(180deg, transparent, #0f1420)",
            borderTop: "1px solid #2a2a40",
            zIndex: 50,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
              color: "#3498db",
              fontSize: 13,
              fontWeight: "bold",
            }}
          >
          
            <span style={{ color: "#fff" }}>{cards.length}</span>
          </div>
          <button
            onClick={onExit}
            style={{
              width: "100%",
              background: "linear-gradient(135deg,#e74c3c,#c0392b)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "11px 0",
              fontSize: 13,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Leave
          </button>
        </div>

        {/* ═══════════════════════════════════════════════
             BINGO POPUP
           ═══════════════════════════════════════════════ */}
        {bingoPopup && (
          <>
            <Confetti />
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15,20,32,0.96)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "16px 12px",
                zIndex: 100,
                overflowY: "auto",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                  animation: "popIn 0.5s ease-out",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg,#f39c12,#e67e22)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    boxShadow: "0 0 25px rgba(243,156,18,0.8)",
                  }}
                >
                  👑
                </div>
                <div>
                  <h2
                    style={{
                      color: "#f39c12",
                      margin: 0,
                      fontSize: 30,
                      letterSpacing: 3,
                      fontWeight: "900",
                      background:
                        "linear-gradient(135deg, #f39c12, #ffd43b, #f39c12)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                      animation: "bingoGlow 1.5s ease-in-out infinite",
                      lineHeight: 1,
                    }}
                  >
                    BINGO!
                  </h2>
                  <div
                    style={{
                      color: "#fff",
                      fontSize: 11,
                      marginTop: 2,
                      fontWeight: "bold",
                    }}
                  >
                    🎉 {bingoPopup.winners.length} winner
                    {bingoPopup.winners.length > 1 ? "s" : ""}!
                  </div>
                </div>
              </div>

              {/* Pattern badge */}
              <div
                style={{
                  background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
                  border: "1px solid #f39c12",
                  borderRadius: 20,
                  padding: "4px 12px",
                  fontSize: 10,
                  color: "#f39c12",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  marginBottom: 10,
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 13 }}>
                  {PATTERN_ICONS[bingoPopup.winPattern] || "🎯"}
                </span>
                <span style={{ fontWeight: "bold" }}>
                  {PATTERN_LABELS[bingoPopup.winPattern] ||
                    bingoPopup.winPattern}
                </span>
              </div>

              {/* WINNERS LIST */}
              <div
                style={{
                  background: "linear-gradient(135deg,#1a1a2e,#0f1420)",
                  border: "2px solid #f39c12",
                  borderRadius: 12,
                  padding: 8,
                  width: "100%",
                  maxWidth: 360,
                  marginBottom: 10,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    color: "#f39c12",
                    fontSize: 10,
                    fontWeight: "bold",
                    textAlign: "center",
                    marginBottom: 6,
                    letterSpacing: 1,
                  }}
                >
                  🏆 WINNERS
                </div>
                {bingoPopup.winners.slice(0, 3).map((w, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#0f1420",
                      border: "1px solid #2a2a40",
                      borderRadius: 8,
                      padding: "6px 8px",
                      marginBottom:
                        i < Math.min(bingoPopup.winners.length, 3) - 1
                          ? 5
                          : 0,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: "bold",
                        }}
                      >
                        👤 {w.name}
                      </div>
                      <div
                        style={{
                          fontSize: 9,
                          color: "#888",
                          marginTop: 1,
                        }}
                      >
                        🎴 #{w.cartelas.join(", #")} • 💰 {w.newBalance} ETB
                      </div>
                    </div>
                    <div
                      style={{
                        background: "rgba(46,204,113,0.2)",
                        color: "#2ecc71",
                        borderRadius: 20,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: "bold",
                        flexShrink: 0,
                        marginLeft: 6,
                      }}
                    >
                      +{w.prize}
                    </div>
                  </div>
                ))}
                {bingoPopup.winners.length > 3 && (
                  <div
                    style={{
                      textAlign: "center",
                      color: "#888",
                      fontSize: 10,
                      marginTop: 4,
                    }}
                  >
                    +{bingoPopup.winners.length - 3} ተጨማሪ
                  </div>
                )}
              </div>

              {/* WINNING CARTELAS — ስም + ካርቴላ # + ብር */}
              {bingoPopup.winningCartelas?.length > 0 && (
                <div
                  style={{
                    background: "linear-gradient(135deg,#1a1a2e,#0f1420)",
                    border: "2px solid #2ecc71",
                    borderRadius: 12,
                    padding: 10,
                    width: "100%",
                    maxWidth: 360,
                    marginBottom: 10,
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      color: "#2ecc71",
                      fontSize: 10,
                      fontWeight: "bold",
                      textAlign: "center",
                      marginBottom: 8,
                      letterSpacing: 1,
                    }}
                  >
                    🎴 WINNING CARTELAS ({bingoPopup.winningCartelas.length})
                  </div>

                  {bingoPopup.winningCartelas.slice(0, 2).map((wc, idx) => {
                    const owner = (bingoPopup.winners || []).find(
                      (w) =>
                        w.name === wc.name ||
                        (Array.isArray(w.cartelas) &&
                          w.cartelas.includes(wc.cardId))
                    );
                    const prizeAmount = owner?.prize ?? null;

                    return (
                      <div key={idx} style={{ marginBottom: 10 }}>
                        <div
                          style={{
                            background:
                              "linear-gradient(135deg, rgba(243,156,18,0.15), rgba(15,20,32,0.4))",
                            border: "1px solid rgba(243,156,18,0.4)",
                            borderRadius: 8,
                            padding: "5px 8px",
                            marginBottom: 6,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: "bold",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              👤 {wc.name}
                            </div>
                            <div
                              style={{
                                color: "#f39c12",
                                fontSize: 9,
                                fontWeight: "bold",
                                marginTop: 1,
                              }}
                            >
                              🎴 Card #{wc.cardId}
                            </div>
                          </div>
                          {prizeAmount !== null && (
                            <div
                              style={{
                                background: "rgba(46,204,113,0.2)",
                                color: "#2ecc71",
                                border: "1px solid rgba(46,204,113,0.5)",
                                borderRadius: 20,
                                padding: "3px 10px",
                                fontSize: 11,
                                fontWeight: "bold",
                                flexShrink: 0,
                              }}
                            >
                              +{prizeAmount} ETB
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(5, 1fr)",
                            gap: 3,
                          }}
                        >
                          {wc.card.map((row, r) =>
                            row.map((v, c) => {
                              const m = wc.marked?.[r]?.[c];
                              const free = r === 2 && c === 2;
                              return (
                                <div
                                  key={`${r}-${c}`}
                                  style={{
                                    aspectRatio: 1,
                                    background: free
                                      ? "linear-gradient(135deg, #ffd43b, #f39c12)"
                                      : m
                                      ? "linear-gradient(135deg, #4caf50, #2ecc71)"
                                      : "linear-gradient(135deg, #252d44, #1b2233)",
                                    color: free ? "#1b2233" : "#fff",
                                    fontSize: 12,
                                    fontWeight: "bold",
                                    borderRadius: 4,
                                    border: free
                                      ? "2px solid #ffd43b"
                                      : m
                                      ? "1px solid #2ecc71"
                                      : "1px solid #2a2a40",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    boxShadow: m
                                      ? "0 0 6px rgba(76,175,80,0.5)"
                                      : "none",
                                  }}
                                >
                                  {free ? "★" : v}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {bingoPopup.winningCartelas.length > 2 && (
                    <div
                      style={{
                        textAlign: "center",
                        color: "#888",
                        fontSize: 10,
                        marginTop: 4,
                      }}
                    >
                      +{bingoPopup.winningCartelas.length - 2} ተጨማሪ ካርቴላ
                    </div>
                  )}
                </div>
              )}

              {/* Pool badge */}
              <div
                style={{
                  background: "linear-gradient(135deg,#2ecc71,#27ae60)",
                  borderRadius: 20,
                  padding: "6px 16px",
                  fontSize: 13,
                  fontWeight: "bold",
                  color: "#fff",
                  boxShadow: "0 0 20px rgba(46,204,113,0.5)",
                  marginBottom: 8,
                  flexShrink: 0,
                }}
              >
                💰 Pool: {bingoPopup.prizePool} ETB
              </div>

              <div
                style={{
                  color: "#888",
                  fontSize: 10,
                  marginBottom: 20,
                  fontStyle: "italic",
                  flexShrink: 0,
                }}
              >
                ወደ ካርቴላ ምርጫ በመመለስ ላይ...
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ icon, label, value, color = "#fff", size = 16 }) {
  return (
    <div style={{ textAlign: "center", padding: "2px 0" }}>
      {/* Icon on top */}
      <div style={{ fontSize: 14, marginBottom: 2, lineHeight: 1 }}>
        {icon}
      </div>
      {/* Label in middle */}
      <div
        style={{
          color: "#888",
          fontSize: 8,
          marginBottom: 2,
          fontWeight: "bold",
          letterSpacing: 0.3,
          lineHeight: 1.2,
        }}
      >
        {label}
      </div>
      {/* Value at bottom — large colored monospace */}
      <div
        style={{
          color,
          fontSize: size,
          fontWeight: "900",
          lineHeight: 1.15,
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