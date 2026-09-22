import { useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";

const HEADERS = [
  { letter: "B", color: "#4c6ef5" },
  { letter: "I", color: "#9c27b0" },
  { letter: "N", color: "#e91e63" },
  { letter: "G", color: "#4caf50" },
  { letter: "O", color: "#ff9800" },
];

// 👈 ለ Winners Panel ብቻ ያገለግላሉ
const PATTERN_LABELS = {
  "any-row": "ማንኛውም ረድፍ (Any Row)",
  "any-column": "ማንኛውም አምድ (Any Column)",
  "any-diagonal": "ዲያጎናል (Diagonal)",
  "four-corners": "4 ማዕዘን (4 Corners)",
  "full-card": "ሙሉ ካርድ (Full Card)",
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
  for (let r = 0; r < 15; r++) for (let c = 0; c < 5; c++) out.push(c * 15 + r + 1);
  return out;
}

// ═══════════════════════════════════════════════════════
// SOUND MANAGER
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

  callNumber() {
    this.play(880, 120, "sine", 0.2);
    setTimeout(() => this.play(1100, 120, "sine", 0.15), 130);
  },

  bingo() {
    this.play(523, 200, "triangle", 0.25);
    setTimeout(() => this.play(659, 200, "triangle", 0.25), 180);
    setTimeout(() => this.play(784, 400, "triangle", 0.3), 360);
  },

  tick() {
    this.play(600, 60, "square", 0.08);
  },
};

export default function LiveGame({
  roomCode,
  cardIds,
  onExit,
  onGameEnded,
  setBalance,
}) {
  const socketRef = useRef(null);
  const joinedRef = useRef(false);

  const [cards, setCards] = useState([]);
  const [status, setStatus] = useState("waiting");
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastNumber, setLastNumber] = useState(null);
  const [lastLetter, setLastLetter] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [prizePool, setPrizePool] = useState(0);
  const [entryFee, setEntryFee] = useState(0);
  const [flashNumber, setFlashNumber] = useState(false);
  const [bingoPopup, setBingoPopup] = useState(null);
  const [nextGameCountdown, setNextGameCountdown] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    sound.enabled = soundOn;
  }, [soundOn]);

  // ═══════════════════════════════════════════════════
  // SOCKET + RECONNECTION
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    socket.on("disconnect", () => {
      setIsConnected(false);
      console.log("[LiveGame] Disconnected");
    });

    socket.on("connect", () => {
      console.log("[LiveGame] Reconnected!");
      setIsConnected(true);
      if (joinedRef.current && roomCode) {
        socket.emit("join_room", { roomCode, cardIds });
      }
    });

    if (!joinedRef.current) {
      socket.emit("join_room", { roomCode, cardIds });
      joinedRef.current = true;
    }

    // ─── State restore ───
    socket.on("state_restore", (data) => {
      console.log("[LiveGame] State restored:", data);
      setStatus(data.status);
      setCalledNumbers(data.calledNumbers || []);
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
    });

    socket.on("your_cards", (d) => {
      if (!d.cards) return;
      setCards(
        d.cards.map((card, i) => ({
          cardId: d.cardIds?.[i] || i + 1,
          card,
          marked: d.markedCards[i],
        }))
      );
    });

    socket.on("room_state", (s) => {
      setStatus(s.status);
      setPlayerCount(s.playerCount);
      setPrizePool(s.prizePool);
      setEntryFee(s.entryFee || 0);
      setCalledNumbers(s.calledNumbers || []);
      if (s.calledNumbers?.length) {
        const last = s.calledNumbers[s.calledNumbers.length - 1];
        setLastNumber(last);
        setLastLetter(getLetter(last).letter);
      }
    });

    socket.on("game_started", () => {
      setStatus("active");
      setBingoPopup(null);
    });

    // ─── NUMBER CALLED ───
    socket.on("number_called", ({ number, letter, calledNumbers: cn }) => {
      setLastNumber(number);
      setLastLetter(letter || getLetter(number).letter);
      setCalledNumbers(cn);

      if (soundOn) sound.callNumber();

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
    });

    // ─── BINGO POPUP ───
    socket.on("bingo_claimed", (data) => {
      console.log("[LiveGame] BINGO:", data);
      setStatus("finished");
      setBingoPopup(data);
      if (soundOn) sound.bingo();
      if (window.navigator.vibrate)
        window.navigator.vibrate([100, 50, 100, 50, 200]);
    });

    socket.on("game_over", (r) => {
      if (r.nextGameAt) {
        const rem = Math.max(
          0,
          Math.floor((new Date(r.nextGameAt) - Date.now()) / 1000)
        );
        setNextGameCountdown(rem);
      }
    });

    socket.on("next_game_ready", () => {
      setBingoPopup(null);
      setLastNumber(null);
      setLastLetter(null);
      setCalledNumbers([]);
      setNextGameCountdown(0);
      setStatus("waiting");
    });

    socket.on("balance_update", ({ balance: b }) => setBalance(b));

    return () => {
      socket.emit("leave_room");
      joinedRef.current = false;
      [
        "disconnect", "connect", "state_restore", "your_cards", "room_state",
        "game_started", "number_called", "bingo_claimed", "game_over",
        "next_game_ready", "balance_update",
      ].forEach((e) => socket.off(e));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, setBalance, soundOn]);

  // ─── 5 ሰከንድ በኋላ ወደ ካርቴላ መምረጫ ───
  useEffect(() => {
    if (!bingoPopup) return;
    const t = setTimeout(
      () => (onGameEnded ? onGameEnded() : onExit()),
      5000
    );
    return () => clearTimeout(t);
  }, [bingoPopup, onGameEnded, onExit]);

  // ─── የቀጣይ ጨዋታ ቆጣሪ ───
  useEffect(() => {
    if (nextGameCountdown <= 0) return;
    const t = setTimeout(() => {
      setNextGameCountdown((prev) => prev - 1);
      if (soundOn && nextGameCountdown <= 3) sound.tick();
    }, 1000);
    return () => clearTimeout(t);
  }, [nextGameCountdown, soundOn]);

  const lastInfo = lastNumber ? getLetter(lastNumber) : null;

  return (
    <div
      style={{
        padding: 8,
        maxWidth: 480,
        margin: "0 auto",
        color: "#fff",
        minHeight: "100vh",
        background: "#0f1420",
        paddingBottom: 80,
      }}
    >
      {/* ─── Connection status ─── */}
      {!isConnected && (
        <div
          style={{
            background: "#e74c3c",
            color: "#fff",
            padding: "8px",
            borderRadius: 8,
            marginBottom: 8,
            textAlign: "center",
            fontSize: 12,
            fontWeight: "bold",
          }}
        >
          ⚠️ ኔትወርክ ተቋርጧል — በመገናኘት ላይ...
        </div>
      )}

      {/* ─── STATUS BANNER ─── */}
      <div
        style={{
          background:
            status === "active"
              ? "linear-gradient(135deg,#2ecc71,#27ae60)"
              : "linear-gradient(135deg,#f39c12,#e67e22)",
          padding: "14px",
          borderRadius: 12,
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 12,
          boxShadow: "0 4px 15px rgba(243,156,18,0.4)",
        }}
      >
        <div style={{ fontSize: 32 }}>
          {status === "active" ? "🎯" : "⏳"}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: "bold",
              color: "#fff",
              textAlign: "center",
            }}
          >
            {status === "waiting"
              ? "🎮 ጨዋታው በቅርቡ ይጀመራል"
              : status === "active"
              ? "🎯 ጨዋታው በሂደት ላይ ነው"
              : "🏁 ጨዋታው ተጠናቅቋል"}
          </div>
        </div>
        <button
          onClick={() => setSoundOn((s) => !s)}
          style={{
            background: "rgba(0,0,0,0.2)",
            border: "none",
            color: "#fff",
            fontSize: 22,
            borderRadius: 8,
            padding: "6px 10px",
            cursor: "pointer",
          }}
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
      </div>

      {/* ─── STATS ─── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 4,
          marginBottom: 8,
        }}
      >
        <Stat label="Game ID" value={roomCode} color="#f39c12" />
        <Stat label="Players" value={playerCount} />
        <Stat label="Bet" value={entryFee} />
        <Stat label="Derash" value={prizePool} color="#2ecc71" />
        <Stat label="Called" value={calledNumbers.length} />
      </div>

      {/* ─── MAIN ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {/* LEFT — BINGO board */}
        <div
          style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a40",
            borderRadius: 10,
            padding: 6,
            overflowY: "auto",
            maxHeight: "calc(100vh - 260px)",
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
                  background: h.color,
                  color: "#fff",
                  textAlign: "center",
                  fontWeight: "bold",
                  fontSize: 14,
                  padding: "6px 0",
                  borderRadius: 6,
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
                style={{ marginBottom: cards.length > 1 ? 10 : 0 }}
              >
                <div
                  style={{
                    textAlign: "center",
                    color: "#f39c12",
                    fontSize: 10,
                    fontWeight: "bold",
                    marginBottom: 4,
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
                              ? "#ffd43b"
                              : isLast
                              ? "#ff9800"
                              : marked
                              ? "#4caf50"
                              : "#252d44",
                            color: free ? "#1b2233" : "#fff",
                            fontSize: 12,
                            fontWeight: "bold",
                            borderRadius: 6,
                            border: isLast
                              ? "2px solid #ffd43b"
                              : "1px solid #333",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "background 0.2s",
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
                        ? "#ff9800"
                        : called
                        ? info.color
                        : "#252d44",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: "bold",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: isLast
                        ? "2px solid #ffd43b"
                        : "1px solid #333",
                      transition: "background 0.2s",
                    }}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT — Current number */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              background: "#1a1a2e",
              border: flashNumber
                ? "2px solid #ffd43b"
                : "1px solid #f39c12",
              borderRadius: 10,
              padding: 12,
              textAlign: "center",
              minHeight: 160,
              transition: "border 0.3s, box-shadow 0.3s",
              boxShadow: flashNumber
                ? "0 0 25px rgba(255,212,59,0.6)"
                : "none",
            }}
          >
            <div
              style={{
                color: "#aaa",
                fontSize: 10,
                marginBottom: 6,
                letterSpacing: 1,
              }}
            >
              CURRENT
            </div>

            {lastInfo ? (
              <div
                style={{
                  background: "#fff",
                  color: lastInfo.color,
                  borderRadius: "50%",
                  width: 90,
                  height: 90,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: "bold",
                  fontSize: 24,
                  margin: "0 auto",
                  border: "4px solid #f39c12",
                  boxShadow: "0 0 30px rgba(243,156,18,0.7)",
                  transform: flashNumber ? "scale(1.15)" : "scale(1)",
                  transition: "transform 0.3s ease-out",
                }}
              >
                {lastLetter || lastInfo.letter}-{lastNumber}
              </div>
            ) : (
              <div
                style={{ color: "#666", fontSize: 13, padding: "30px 0" }}
              >
                በመጠበቅ ላይ...
              </div>
            )}
          </div>

          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a40",
              borderRadius: 10,
              padding: 14,
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              minHeight: 120,
            }}
          >
            {status === "waiting" && (
              <div
                style={{
                  color: "#f39c12",
                  fontSize: 13,
                  textAlign: "center",
                  lineHeight: 1.8,
                }}
              >
                🎯 ጨዋታው
                <br />
                በቅርቡ ይጀመራል
              </div>
            )}
            {status === "active" && (
              <div
                style={{
                  color: "#2ecc71",
                  fontSize: 14,
                  textAlign: "center",
                  lineHeight: 1.8,
                }}
              >
                🎯 ጨዋታው
                <br />
                በሂደት ላይ ነው
              </div>
            )}
            {status === "finished" && (
              <div
                style={{
                  color: "#f39c12",
                  fontSize: 14,
                  textAlign: "center",
                  lineHeight: 1.8,
                }}
              >
                🏁 ጨዋታው
                <br />
                ተጠናቅቋል
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── BOTTOM ─── */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          maxWidth: 480,
          margin: "0 auto",
          padding: "10px 12px",
          background: "#0f1420",
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
            borderRadius: 12,
            padding: "14px 0",
            fontSize: 14,
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          Leave
        </button>
      </div>

      {/* ═══════════════════════════════════════════════
          BINGO POPUP + WINNERS PANEL
         ═══════════════════════════════════════════════ */}
      {bingoPopup && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,20,32,0.97)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "20px 15px",
            gap: 14,
            zIndex: 100,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#f39c12,#e67e22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 44,
              boxShadow: "0 0 50px rgba(243,156,18,0.8)",
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
              fontSize: 42,
              letterSpacing: 4,
              fontWeight: "bold",
              textShadow: "0 0 20px rgba(243,156,18,0.6)",
            }}
          >
            BINGO!
          </h2>

          <p
            style={{
              color: "#fff",
              fontSize: 18,
              margin: 0,
              fontWeight: "bold",
            }}
          >
            🎉 {bingoPopup.winners.length} winner
            {bingoPopup.winners.length > 1 ? "s" : ""}!
          </p>

          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #f39c12",
              borderRadius: 10,
              padding: "8px 16px",
              fontSize: 12,
              color: "#f39c12",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>
              {PATTERN_ICONS[bingoPopup.winPattern] || "🎯"}
            </span>
            <span>
              {PATTERN_LABELS[bingoPopup.winPattern] || bingoPopup.winPattern}
            </span>
          </div>

          {/* WINNERS PANEL */}
          <div
            style={{
              background: "linear-gradient(135deg,#1a1a2e,#0f1420)",
              border: "2px solid #f39c12",
              borderRadius: 16,
              padding: 14,
              width: "100%",
              maxWidth: 400,
            }}
          >
            <div
              style={{
                color: "#f39c12",
                fontSize: 13,
                fontWeight: "bold",
                textAlign: "center",
                marginBottom: 12,
                letterSpacing: 1,
              }}
            >
              🏆 WINNERS PANEL
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
                    i < bingoPopup.winners.length - 1 ? 8 : 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{
                      color: "#fff",
                      fontSize: 14,
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
                      padding: "3px 10px",
                      fontSize: 11,
                      fontWeight: "bold",
                    }}
                  >
                    +{w.prize} ETB
                  </div>
                </div>
                <div
                  style={{ fontSize: 11, color: "#aaa", lineHeight: 1.7 }}
                >
                  <div>
                    🆔 Telegram ID:{" "}
                    <span style={{ color: "#f39c12" }}>{w.telegramId}</span>
                  </div>
                  <div>
                    🎴 Cartela:{" "}
                    <span style={{ color: "#f39c12", fontWeight: "bold" }}>
                      {w.cartelas.map((c) => `#${c}`).join(", ")}
                    </span>
                  </div>
                  <div>
                    💰 New Balance:{" "}
                    <span style={{ color: "#2ecc71", fontWeight: "bold" }}>
                      {w.newBalance} ETB
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* WINNING CARTELA GRIDS */}
          {bingoPopup.winningCartelas?.length > 0 && (
            <div
              style={{
                background: "#1a1a2e",
                border: "1px solid #2a2a40",
                borderRadius: 12,
                padding: 12,
                width: "100%",
                maxWidth: 400,
              }}
            >
              <div
                style={{
                  color: "#f39c12",
                  fontSize: 12,
                  fontWeight: "bold",
                  marginBottom: 8,
                  textAlign: "center",
                }}
              >
                🎴 WINNING CARTELAS ({bingoPopup.winningCartelas.length})
              </div>

              {bingoPopup.winningCartelas.slice(0, 2).map((wc, idx) => (
                <div key={idx} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      color: "#fff",
                      fontSize: 12,
                      marginBottom: 6,
                      textAlign: "center",
                    }}
                  >
                    #{wc.cardId} — {wc.name}{" "}
                    <span style={{ color: "#f39c12" }}>
                      ({wc.subPattern})
                    </span>
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
                                ? "#4caf50"
                                : m
                                ? "#f39c12"
                                : "#fff",
                              color: m || free ? "#fff" : "#1b2233",
                              fontSize: 12,
                              fontWeight: "bold",
                              borderRadius: 5,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              border: "1px solid #ddd",
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

          {/* PRIZE POOL */}
          <div
            style={{
              background: "linear-gradient(135deg,#2ecc71,#27ae60)",
              borderRadius: 12,
              padding: "10px 24px",
              fontSize: 16,
              fontWeight: "bold",
              color: "#fff",
              textShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          >
            💰 Total Pool: {bingoPopup.prizePool} ETB
          </div>

          {nextGameCountdown > 0 && (
            <div style={{ color: "#aaa", fontSize: 13 }}>
              ቀጣይ ጨዋታ በ{" "}
              <b style={{ color: "#f39c12" }}>{nextGameCountdown}s</b>
            </div>
          )}

          <style>{`
            @keyframes popIn {
              0% { transform: scale(0); opacity: 0; }
              60% { transform: scale(1.15); opacity: 1; }
              100% { transform: scale(1); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = "#fff" }) {
  return (
    <div
      style={{
        background: "#1a1a2e",
        border: "1px solid #2a2a40",
        borderRadius: 8,
        padding: "6px 4px",
        textAlign: "center",
      }}
    >
      <div style={{ color: "#aaa", fontSize: 9, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ color, fontSize: 12, fontWeight: "bold" }}>{value}</div>
    </div>
  );
}