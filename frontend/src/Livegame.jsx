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
function PatternPreview({ pattern }) {
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
        maxWidth: 70,
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
// MINI CARD (My Cards tracker)
// ═══════════════════════════════════════════════════════
function MiniCard({ card, marked, cardId, lastNumber }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          textAlign: "center",
          fontSize: 10,
          color: "#f39c12",
          fontWeight: "bold",
          marginBottom: 3,
        }}
      >
        #{cardId}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 2,
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
                  fontSize: 9,
                  fontWeight: "bold",
                  borderRadius: 3,
                  background: free
                    ? "linear-gradient(135deg, #ffd43b, #f39c12)"
                    : isLast
                    ? "linear-gradient(135deg, #ff9800, #f39c12)"
                    : m
                    ? "linear-gradient(135deg, #4caf50, #2ecc71)"
                    : "#252d44",
                  color: free ? "#1b2233" : "#fff",
                  border: isLast
                    ? "1.5px solid #ffd43b"
                    : "1px solid #2a2a40",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
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
// CONFETTI
// ═══════════════════════════════════════════════════════
function Confetti() {
  const pieces = Array.from({ length: 50 }, (_, i) => i);
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
        const size = 6 + Math.random() * 8;
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
  const [isConnected, setIsConnected] = useState(true);
  const [numberAnimKey, setNumberAnimKey] = useState(0);

  useEffect(() => {
    soundOnRef.current = soundOn;
    sound.enabled = soundOn;
  }, [soundOn]);

  // ═══════════════════════════════════════════════════
  // SOCKET
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const onDisconnect = () => setIsConnected(false);
    const onConnect = () => {
      setIsConnected(true);
      if (joinedRef.current && roomCode) {
        socket.emit("join_room", { roomCode, cardIds });
      }
    };

    const onStateRestore = (data) => {
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

    const onYourCards = (d) => {
      if (!d.cards) return;
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
      setCalledNumbers(s.calledNumbers || []);
      if (s.winPattern) setWinPattern(s.winPattern);
      if (s.calledNumbers?.length) {
        const last = s.calledNumbers[s.calledNumbers.length - 1];
        setLastNumber(last);
        setLastLetter(getLetter(last).letter);
      }
    };

    const onGameStarted = (data) => {
      setBingoPopup(null);
      if (data.winPattern) setWinPattern(data.winPattern);
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

    const onBingoClaimed = (data) => {
      setBingoPopup(data);
      if (data.winPattern) setWinPattern(data.winPattern);
      if (soundOnRef.current) sound.bingo();
      if (window.navigator.vibrate)
        window.navigator.vibrate([100, 50, 100, 50, 200]);
    };

    const onGameOver = () => {
      setTimeout(() => {
        if (onGameEnded) onGameEnded();
        else onExit();
      }, 5000);
    };

    const onNextGameReady = () => {
      setBingoPopup(null);
      setLastNumber(null);
      setLastLetter(null);
      setCalledNumbers([]);
    };

    const onBalanceUpdate = ({ balance: b }) => setBalance(b);

    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    socket.on("state_restore", onStateRestore);
    socket.on("your_cards", onYourCards);
    socket.on("room_state", onRoomState);
    socket.on("game_started", onGameStarted);
    socket.on("number_called", onNumberCalled);
    socket.on("bingo_claimed", onBingoClaimed);
    socket.on("game_over", onGameOver);
    socket.on("next_game_ready", onNextGameReady);
    socket.on("balance_update", onBalanceUpdate);

    if (!joinedRef.current) {
      socket.emit("join_room", { roomCode, cardIds });
      joinedRef.current = true;
    }

    return () => {
      socket.emit("leave_room");
      joinedRef.current = false;
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
      socket.off("state_restore", onStateRestore);
      socket.off("your_cards", onYourCards);
      socket.off("room_state", onRoomState);
      socket.off("game_started", onGameStarted);
      socket.off("number_called", onNumberCalled);
      socket.off("bingo_claimed", onBingoClaimed);
      socket.off("game_over", onGameOver);
      socket.off("next_game_ready", onNextGameReady);
      socket.off("balance_update", onBalanceUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, setBalance]);

  const lastInfo = lastNumber ? getLetter(lastNumber) : null;

  const animationStyles = `
    @keyframes popIn {
      0% { transform: scale(0); opacity: 0; }
      60% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(1); }
    }
    @keyframes bingoGlow {
      0%, 100% { text-shadow: 0 0 20px rgba(243,156,18,0.6); transform: scale(1); }
      50% { text-shadow: 0 0 40px rgba(243,156,18,1), 0 0 80px rgba(243,156,18,0.8); transform: scale(1.05); }
    }
    @keyframes confettiFall {
      0% { transform: translateY(0) rotate(0deg); opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }
    @keyframes cellFlash {
      0% { box-shadow: 0 0 0 0 rgba(255,152,0,0.9); }
      100% { box-shadow: 0 0 0 12px rgba(255,152,0,0); }
    }
    /* ═══════════════════════════════════════════════ */
    /* 👑 አዲስ ውብ አኒሜሽኖች ለ CURRENT */
    /* ═══════════════════════════════════════════════ */
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
    @keyframes shimmer {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    @keyframes glowPulse {
      0%, 100% { box-shadow: 0 0 20px currentColor; }
      50% { box-shadow: 0 0 45px currentColor, 0 0 70px currentColor; }
    }
    @keyframes floatBadge {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-3px); }
    }
  `;

  return (
    <>
      <style>{animationStyles}</style>
      <div
        style={{
          padding: 8,
          maxWidth: 480,
          margin: "0 auto",
          color: "#fff",
          minHeight: "100vh",
          background: "linear-gradient(180deg, #0f1420 0%, #1a0f2e 100%)",
          paddingBottom: 75,
        }}
      >
        {!isConnected && (
          <div
            style={{
              background: "linear-gradient(135deg, #e74c3c, #c0392b)",
              color: "#fff",
              padding: "6px",
              borderRadius: 8,
              marginBottom: 6,
              textAlign: "center",
              fontSize: 11,
              fontWeight: "bold",
            }}
          >
            ⚠️ Network lost — reconnecting...
          </div>
        )}

        {/* STATS */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 4,
            marginBottom: 6,
          }}
        >
          <Stat label="Game" value={roomCode} color="#f39c12" />
          <Stat label="Players" value={playerCount} color="#3498db" />
          <Stat label="Stake" value={entryFee} color="#9c27b0" />
          <Stat label="Prize" value={prizePool} color="#2ecc71" />
          <Stat label="Called" value={calledNumbers.length} color="#ffd43b" />
        </div>

        {/* MAIN */}
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}
        >
          {/* LEFT — BINGO board */}
          <div
            style={{
              background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
              border: "1px solid #2a2a40",
              borderRadius: 10,
              padding: 5,
              overflowY: "auto",
              maxHeight: "calc(100vh - 180px)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 3,
                marginBottom: 3,
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
                    fontSize: 13,
                    padding: "5px 0",
                    borderRadius: 5,
                  }}
                >
                  {h.letter}
                </div>
              ))}
            </div>

            {cards.length > 0 ? (
              cards.map((ci, idx) => (
                <div
                  key={idx}
                  style={{ marginBottom: cards.length > 1 ? 8 : 0 }}
                >
                  <div
                    style={{
                      textAlign: "center",
                      color: "#f39c12",
                      fontSize: 9,
                      fontWeight: "bold",
                      marginBottom: 3,
                    }}
                  >
                    #{ci.cardId}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(5, 1fr)",
                      gap: 3,
                    }}
                  >
                    {ci.card.map((row, r) =>
                      row.map((v, c) => {
                        const marked = ci.marked?.[r]?.[c];
                        const free = r === 2 && c === 2;
                        const isLast = !free && lastNumber === v;
                        return (
                          <div
                            key={`${r}-${c}`}
                            style={{
                              aspectRatio: 1,
                              background: free
                                ? "linear-gradient(135deg, #ffd43b, #f39c12)"
                                : isLast
                                ? "linear-gradient(135deg, #ff9800, #f39c12)"
                                : marked
                                ? "linear-gradient(135deg, #4caf50, #2ecc71)"
                                : "linear-gradient(135deg, #252d44, #1b2233)",
                              color: free ? "#1b2233" : "#fff",
                              fontSize: 12,
                              fontWeight: "bold",
                              borderRadius: 5,
                              border: isLast
                                ? "2px solid #ffd43b"
                                : "1px solid #2a2a40",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              transition: "all 0.3s",
                              animation: isLast
                                ? "cellFlash 0.6s ease-out"
                                : "none",
                              transform: isLast ? "scale(1.1)" : "scale(1)",
                              boxShadow: isLast
                                ? "0 0 12px rgba(255,152,0,0.8)"
                                : marked
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
              ))
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: 3,
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
                        fontSize: 11,
                        fontWeight: "bold",
                        borderRadius: 5,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: isLast
                          ? "2px solid #ffd43b"
                          : "1px solid #2a2a40",
                        animation: isLast
                          ? "cellFlash 0.6s ease-out"
                          : "none",
                      }}
                    >
                      {n}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT — Current + Pattern + Tracker */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* ═══════════════════════════════════════════
                👑 ውብ CURRENT BOX — አዲስ!
               ═══════════════════════════════════════════ */}
            <div
              style={{
                background: lastInfo
                  ? `linear-gradient(135deg, ${lastInfo.color}33 0%, #1a1a2e 40%, #0f1420 100%)`
                  : "linear-gradient(135deg, #1a1a2e, #0f1420)",
                border: flashNumber
                  ? `2px solid ${lastInfo?.color || "#ffd43b"}`
                  : "2px solid #f39c12",
                borderRadius: 14,
                padding: "12px 8px 10px",
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
                boxShadow: flashNumber
                  ? `0 0 35px ${lastInfo?.color || "#ffd43b"}99, inset 0 0 30px ${
                      lastInfo?.color || "#ffd43b"
                    }33`
                  : `0 0 15px ${lastInfo?.color || "#f39c12"}55`,
                transition: "all 0.3s ease",
              }}
            >
              {/* Background glow when active */}
              {lastInfo && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: `radial-gradient(circle at center, ${lastInfo.color}22 0%, transparent 70%)`,
                    pointerEvents: "none",
                  }}
                />
              )}

              {/* Sound toggle */}
              <button
                onClick={() => setSoundOn((s) => !s)}
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  background: soundOn
                    ? "linear-gradient(135deg, #2ecc71, #27ae60)"
                    : "#555",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "3px 7px",
                  fontSize: 11,
                  fontWeight: "bold",
                  cursor: "pointer",
                  zIndex: 3,
                  boxShadow: soundOn
                    ? "0 0 8px rgba(46,204,113,0.6)"
                    : "none",
                }}
              >
                {soundOn ? "🔊" : "🔇"}
              </button>

              {/* CURRENT label */}
              <div
                style={{
                  color: lastInfo?.color || "#aaa",
                  fontSize: 8,
                  marginBottom: 6,
                  letterSpacing: 2,
                  fontWeight: "bold",
                  textShadow: lastInfo
                    ? `0 0 10px ${lastInfo.color}`
                    : "none",
                  transition: "color 0.3s",
                }}
              >
                ⚡ CURRENT
              </div>

              {/* Number display */}
              {lastInfo ? (
                <div
                  style={{
                    position: "relative",
                    width: 84,
                    height: 84,
                    margin: "0 auto",
                  }}
                >
                  {/* Outer pulse ring */}
                  <div
                    style={{
                      position: "absolute",
                      inset: -10,
                      borderRadius: "50%",
                      border: `2px solid ${lastInfo.color}`,
                      animation: "ringPulse 1.5s ease-in-out infinite",
                      pointerEvents: "none",
                    }}
                  />
                  {/* Rotating dashed ring */}
                  <div
                    style={{
                      position: "absolute",
                      inset: -5,
                      borderRadius: "50%",
                      border: `2px dashed ${lastInfo.color}aa`,
                      animation: "ringRotate 8s linear infinite",
                      pointerEvents: "none",
                    }}
                  />

                  {/* Main number circle */}
                  <div
                    key={numberAnimKey}
                    style={{
                      position: "relative",
                      width: 84,
                      height: 84,
                      borderRadius: "50%",
                      background: `radial-gradient(circle at 30% 30%, #ffffff 0%, #fafafa 45%, ${lastInfo.color}33 100%)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "900",
                      color: lastInfo.color,
                      border: `4px solid ${lastInfo.color}`,
                      animation:
                        "numberBigPop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)",
                      boxShadow: `0 0 35px ${lastInfo.color}99, inset 0 -8px 25px ${lastInfo.color}33, inset 0 8px 18px #ffffff`,
                      textShadow: `0 1px 2px #ffffff, 0 2px 8px ${lastInfo.color}44`,
                      zIndex: 2,
                      overflow: "hidden",
                    }}
                  >
                    {/* Letter part */}
                    <span
                      style={{
                        fontSize: 15,
                        opacity: 0.85,
                        marginRight: 1,
                        fontWeight: "800",
                      }}
                    >
                      {lastLetter || lastInfo.letter}
                    </span>
                    {/* Number part */}
                    <span
                      style={{
                        fontSize: 30,
                        fontWeight: "900",
                        lineHeight: 1,
                      }}
                    >
                      {lastNumber}
                    </span>
                  </div>

                  {/* Shimmer overlay */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      background:
                        "linear-gradient(120deg, transparent 40%, rgba(255,255,255,0.8) 50%, transparent 60%)",
                      backgroundSize: "200% 100%",
                      animation: "shimmer 2s linear infinite",
                      pointerEvents: "none",
                      mixBlendMode: "overlay",
                      zIndex: 3,
                    }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    width: 84,
                    height: 84,
                    margin: "0 auto",
                    borderRadius: "50%",
                    background:
                      "radial-gradient(circle, #1a1a2e 0%, #0f1420 100%)",
                    border: "3px dashed #2a2a40",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#444",
                    fontSize: 24,
                    fontWeight: "bold",
                    animation: "ringPulse 2s ease-in-out infinite",
                  }}
                >
                  ?
                </div>
              )}

              {/* Called count badge */}
              <div
                style={{
                  marginTop: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: `${lastInfo?.color || "#f39c12"}22`,
                  border: `1px solid ${lastInfo?.color || "#f39c12"}66`,
                  borderRadius: 20,
                  padding: "3px 12px",
                  fontSize: 10,
                  color: lastInfo?.color || "#f39c12",
                  fontWeight: "bold",
                  textShadow: `0 0 8px ${lastInfo?.color || "#f39c12"}66`,
                  animation: "floatBadge 2s ease-in-out infinite",
                }}
              >
                📢 {calledNumbers.length} / 75
              </div>
            </div>

            {/* PATTERN */}
            <div
              style={{
                background: "linear-gradient(135deg, #1a1a2e 0%, #0f1420 100%)",
                border: "2px solid #f39c12",
                borderRadius: 10,
                padding: "6px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                boxShadow: "0 0 10px rgba(243,156,18,0.25)",
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
              <PatternPreview pattern={winPattern} />
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

            {/* MY CARDS TRACKER */}
            {cards.length > 0 && (
              <div
                style={{
                  background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
                  border: "2px solid #3498db",
                  borderRadius: 10,
                  padding: 8,
                  flex: 1,
                  overflowY: "auto",
                  maxHeight: 240,
                  boxShadow: "0 0 10px rgba(52,152,219,0.25)",
                }}
              >
                <div
                  style={{
                    color: "#3498db",
                    fontSize: 9,
                    fontWeight: "bold",
                    letterSpacing: 1,
                    marginBottom: 6,
                    textAlign: "center",
                  }}
                >
                  🎴 MY CARDS ({cards.length})
                </div>
                {cards.map((ci, idx) => (
                  <MiniCard
                    key={idx}
                    card={ci.card}
                    marked={ci.marked}
                    cardId={ci.cardId}
                    lastNumber={lastNumber}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM */}
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
          }}
        >
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

        {/* BINGO POPUP */}
        {bingoPopup && (
          <>
            <Confetti />
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15,20,32,0.97)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "20px 15px",
                gap: 12,
                zIndex: 100,
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  width: 70,
                  height: 70,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg,#f39c12,#e67e22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 38,
                  boxShadow: "0 0 40px rgba(243,156,18,0.8)",
                  marginTop: 10,
                  animation: "popIn 0.5s ease-out",
                }}
              >
                👑
              </div>

              <h2
                style={{
                  color: "#f39c12",
                  margin: 0,
                  fontSize: 44,
                  letterSpacing: 5,
                  fontWeight: "bold",
                  background:
                    "linear-gradient(135deg, #f39c12, #ffd43b, #f39c12)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  animation:
                    "bingoGlow 1.5s ease-in-out infinite, popIn 0.5s ease-out",
                }}
              >
                BINGO!
              </h2>

              <p
                style={{
                  color: "#fff",
                  fontSize: 16,
                  margin: 0,
                  fontWeight: "bold",
                }}
              >
                🎉 {bingoPopup.winners.length} winner
                {bingoPopup.winners.length > 1 ? "s" : ""}!
              </p>

              <div
                style={{
                  background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
                  border: "1px solid #f39c12",
                  borderRadius: 10,
                  padding: "6px 14px",
                  fontSize: 11,
                  color: "#f39c12",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 16 }}>
                  {PATTERN_ICONS[bingoPopup.winPattern] || "🎯"}
                </span>
                <span>
                  {PATTERN_LABELS[bingoPopup.winPattern] ||
                    bingoPopup.winPattern}
                </span>
              </div>

              <div
                style={{
                  background: "linear-gradient(135deg,#1a1a2e,#0f1420)",
                  border: "2px solid #f39c12",
                  borderRadius: 14,
                  padding: 12,
                  width: "100%",
                  maxWidth: 380,
                }}
              >
                <div
                  style={{
                    color: "#f39c12",
                    fontSize: 12,
                    fontWeight: "bold",
                    textAlign: "center",
                    marginBottom: 10,
                  }}
                >
                  🏆 WINNERS
                </div>
                {bingoPopup.winners.map((w, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#0f1420",
                      border: "1px solid #2a2a40",
                      borderRadius: 10,
                      padding: 10,
                      marginBottom:
                        i < bingoPopup.winners.length - 1 ? 6 : 0,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <div
                        style={{
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: "bold",
                        }}
                      >
                        👤 {w.name}
                      </div>
                      <div
                        style={{
                          background: "rgba(46,204,113,0.2)",
                          color: "#2ecc71",
                          borderRadius: 20,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: "bold",
                        }}
                      >
                        +{w.prize} ETB
                      </div>
                    </div>
                    <div
                      style={{ fontSize: 10, color: "#aaa", lineHeight: 1.5 }}
                    >
                      🎴 {w.cartelas.map((c) => `#${c}`).join(", ")} • 💰{" "}
                      {w.newBalance} ETB
                    </div>
                  </div>
                ))}
              </div>

              {bingoPopup.winningCartelas?.length > 0 && (
                <div
                  style={{
                    background: "#1a1a2e",
                    border: "1px solid #2a2a40",
                    borderRadius: 10,
                    padding: 10,
                    width: "100%",
                    maxWidth: 380,
                  }}
                >
                  <div
                    style={{
                      color: "#f39c12",
                      fontSize: 11,
                      fontWeight: "bold",
                      marginBottom: 8,
                      textAlign: "center",
                    }}
                  >
                    🎴 WINNING CARTELAS (
                    {bingoPopup.winningCartelas.length})
                  </div>
                  {bingoPopup.winningCartelas.slice(0, 2).map((wc, idx) => (
                    <div key={idx} style={{ marginBottom: 10 }}>
                      <div
                        style={{
                          color: "#fff",
                          fontSize: 11,
                          marginBottom: 5,
                          textAlign: "center",
                        }}
                      >
                        #{wc.cardId} — {wc.name}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(5, 1fr)",
                          gap: 2,
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
                                    ? "#4caf50"
                                    : m
                                    ? "#f39c12"
                                    : "#fff",
                                  color: m || free ? "#fff" : "#1b2233",
                                  fontSize: 11,
                                  fontWeight: "bold",
                                  borderRadius: 4,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {free ? "★" : v}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  background: "linear-gradient(135deg,#2ecc71,#27ae60)",
                  borderRadius: 10,
                  padding: "8px 20px",
                  fontSize: 15,
                  fontWeight: "bold",
                  color: "#fff",
                }}
              >
                💰 Pool: {bingoPopup.prizePool} ETB
              </div>

              <div style={{ color: "#888", fontSize: 11, marginTop: 4 }}>
                Returning to card selection...
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, color = "#fff" }) {
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${color}22, ${color}08)`,
        border: `1px solid ${color}66`,
        borderRadius: 8,
        padding: "5px 2px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          color: "#aaa",
          fontSize: 8,
          marginBottom: 1,
          fontWeight: "bold",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontSize: 11,
          fontWeight: "bold",
          textShadow: `0 0 8px ${color}66`,
        }}
      >
        {value}
      </div>
    </div>
  );
}