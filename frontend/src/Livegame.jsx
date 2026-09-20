import { useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";

const HEADERS = [
  { letter: "B", color: "#4c6ef5" },
  { letter: "I", color: "#9c27b0" },
  { letter: "N", color: "#e91e63" },
  { letter: "G", color: "#4caf50" },
  { letter: "O", color: "#ff9800" },
];

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

function LoadingDots() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % 3), 400);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 10 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 10, height: 10, borderRadius: "50%",
            background: active >= i ? "#e91e63" : "#3a3a55",
            transition: "background 0.3s",
          }}
        />
      ))}
    </div>
  );
}

export default function LiveGame({ roomCode, cardIds, onExit, onGameEnded, setBalance }) {
  const socketRef = useRef(null);
  const joinedRef = useRef(false);
  const soundOnRef = useRef(false);

  const [cards, setCards] = useState([]);
  const [status, setStatus] = useState("waiting");
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastNumber, setLastNumber] = useState(null);
  const [lastLetter, setLastLetter] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [prizePool, setPrizePool] = useState(0);
  const [entryFee, setEntryFee] = useState(0);
  const [banner, setBanner] = useState("");
  const [gameOver, setGameOver] = useState(null);
  const [watching, setWatching] = useState(false);
  const [nextGameCountdown, setNextGameCountdown] = useState(0);
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  // ─── Socket setup ───
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    if (!joinedRef.current) {
      socket.emit("join_room", { roomCode, cardIds });
      joinedRef.current = true;
    }

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

    socket.on("watching_mode", () => setWatching(true));

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
      setBanner("");
    });

    // 👈 NUMBER CALLED — highlight + show prominently
    socket.on("number_called", ({ number, letter, calledNumbers: cn }) => {
      setLastNumber(number);
      setLastLetter(letter || getLetter(number).letter);
      setCalledNumbers(cn);

      // Auto-mark client-side too (server also marks)
      setCards((prev) =>
        prev.map((ci) => {
          const m = ci.marked.map((r) => [...r]);
          for (let r = 0; r < 5; r++)
            for (let c = 0; c < 5; c++)
              if (ci.card[r][c] === number) m[r][c] = true;
          return { ...ci, marked: m };
        })
      );

      if (soundOnRef.current && window.navigator.vibrate) {
        window.navigator.vibrate(80);
      }
    });

    socket.on("bingo_claimed", (d) => {
      const names = d.winners.map((w) => w.name).join(", ");
      setBanner(`🎉 BINGO! ${names} won!`);
    });

    socket.on("bingo_rejected", ({ message }) => setBanner(message));

    socket.on("game_over", (r) => {
      setStatus("finished");
      setGameOver(r);
      if (r.nextGameAt) {
        const rem = Math.max(0, Math.floor((new Date(r.nextGameAt) - Date.now()) / 1000));
        setNextGameCountdown(rem);
      }
    });

    socket.on("next_game_ready", () => {
      setGameOver(null);
      setBanner("");
      setLastNumber(null);
      setLastLetter(null);
      setCalledNumbers([]);
      setNextGameCountdown(0);
      setStatus("waiting");
    });

    socket.on("balance_update", ({ balance: b }) => setBalance(b));
    socket.on("error_message", ({ message }) => {
      if (!message.includes("Insufficient")) setBanner(message);
    });

    return () => {
      socket.emit("leave_room");
      joinedRef.current = false;
      [
        "your_cards", "watching_mode", "room_state", "game_started",
        "number_called", "bingo_claimed", "bingo_rejected",
        "game_over", "next_game_ready", "balance_update", "error_message",
      ].forEach((e) => socket.off(e));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, setBalance]);

  // ─── Countdown to next game ───
  useEffect(() => {
    if (nextGameCountdown <= 0) return;
    const t = setTimeout(() => setNextGameCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [nextGameCountdown]);

  // ─── Auto-return to cartela after winner screen ───
  useEffect(() => {
    if (!gameOver) return;
    const t = setTimeout(() => (onGameEnded ? onGameEnded() : onExit()), 8000);
    return () => clearTimeout(t);
  }, [gameOver, onGameEnded, onExit]);

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
      {/* ─── TOP STATS ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginBottom: 8 }}>
        <Stat label="Game ID" value={roomCode} color="#f39c12" />
        <Stat label="Players" value={playerCount} />
        <Stat label="Bet" value={entryFee} />
        <Stat label="Derash" value={prizePool} color="#2ecc71" />
        <Stat label="Called" value={calledNumbers.length} />
      </div>

      {banner && (
        <div
          style={{
            background: "#2c3550",
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 12,
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          {banner}
        </div>
      )}

      {/* ─── MAIN GRID ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {/* LEFT — BINGO board */}
        <div
          style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a40",
            borderRadius: 10,
            padding: 6,
            overflowY: "auto",
            maxHeight: "calc(100vh - 180px)",
          }}
        >
          {/* B-I-N-G-O headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3, marginBottom: 3 }}>
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
              <div key={idx} style={{ marginBottom: cards.length > 1 ? 10 : 0 }}>
                <div style={{ textAlign: "center", color: "#f39c12", fontSize: 10, fontWeight: "bold", marginBottom: 4 }}>
                  #{ci.cardId}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3 }}>
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
                            border: isLast ? "2px solid #ffd43b" : "1px solid #333",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "background 0.3s",
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
            // Watcher — 1-75 board
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3 }}>
              {buildBoard().map((n) => {
                const info = getLetter(n);
                const called = calledNumbers.includes(n);
                const isLast = lastNumber === n;
                return (
                  <div
                    key={n}
                    style={{
                      aspectRatio: 1,
                      background: isLast ? "#ff9800" : called ? info.color : "#252d44",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: "bold",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: isLast ? "2px solid #ffd43b" : "1px solid #333",
                      transition: "background 0.3s",
                    }}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT — current number + status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* 👈 CURRENT NUMBER (big circle) */}
          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #f39c12",
              borderRadius: 10,
              padding: 12,
              textAlign: "center",
              minHeight: 160,
              position: "relative",
            }}
          >
            <button
              onClick={() => setSoundOn((s) => !s)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "transparent",
                border: "none",
                color: soundOn ? "#ffd43b" : "#666",
                fontSize: 18,
                cursor: "pointer",
                padding: 0,
              }}
            >
              {soundOn ? "🔊" : "🔇"}
            </button>

            <div style={{ color: "#aaa", fontSize: 10, marginBottom: 6, letterSpacing: 1 }}>
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
                }}
              >
                {lastLetter || lastInfo.letter}-{lastNumber}
              </div>
            ) : (
              <div style={{ color: "#666", fontSize: 13, padding: "30px 0" }}>
                በመጠበቅ ላይ...
              </div>
            )}

            <LoadingDots />
          </div>

          {/* Status box */}
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
              minHeight: 180,
            }}
          >
            {watching ? (
              <>
                <div style={{ color: "#fff", fontSize: 16, fontWeight: "bold", marginBottom: 12 }}>
                  Watching Only
                </div>
                <div style={{ color: "#aaa", fontSize: 12, textAlign: "center", lineHeight: 1.8 }}>
                  የእርስዎ ካርቴላ<br />የለም። ጨዋታውን<br />ይከታተሉ::
                </div>
              </>
            ) : status === "waiting" ? (
              <div style={{ color: "#f39c12", fontSize: 13, textAlign: "center", lineHeight: 1.8 }}>
                🎯 ተጫዋቾች<br />እስኪገቡ ድረስ<br />በመጠበቅ ላይ...
              </div>
            ) : status === "active" ? (
              <div style={{ color: "#2ecc71", fontSize: 14, textAlign: "center", lineHeight: 1.8 }}>
                🎯 ጨዋታው<br />በሂደት ላይ ነው
              </div>
            ) : status === "finished" ? (
              <div style={{ color: "#f39c12", fontSize: 14, textAlign: "center", lineHeight: 1.8 }}>
                🏁 ጨዋታው<br />ተጠናቅቋል
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ─── BOTTOM BUTTON ─── */}
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

      {/* ─── WINNER OVERLAY ─── */}
      {gameOver && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,20,32,0.97)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
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
              boxShadow: "0 0 40px rgba(243,156,18,0.7)",
              marginTop: 20,
            }}
          >
            👑
          </div>

          <h2
            style={{
              color: "#f39c12",
              margin: 0,
              fontSize: 36,
              letterSpacing: 3,
              fontWeight: "bold",
            }}
          >
            BINGO!
          </h2>

          {gameOver.winners?.length ? (
            <>
              <p style={{ color: "#fff", fontSize: 20, margin: 0, fontWeight: "bold" }}>
                🎉 {gameOver.winners.length} player
                {gameOver.winners.length > 1 ? "s" : ""} won!
              </p>

              {/* Winners pills */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  justifyContent: "center",
                  maxWidth: "95%",
                }}
              >
                {gameOver.winners.map((w, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#1a1a2e",
                      border: "1px solid #f39c12",
                      borderRadius: 20,
                      padding: "6px 14px",
                      fontSize: 12,
                      color: "#fff",
                    }}
                  >
                    🏆 {w.name} <span style={{ color: "#f39c12" }}>#{w.cardId}</span>
                  </div>
                ))}
              </div>

              {/* Winning cartela (first winner) */}
              {gameOver.winners[0].card && (
                <div
                  style={{
                    background: "linear-gradient(135deg,#1a1a2e,#0f1420)",
                    border: "2px solid #f39c12",
                    borderRadius: 16,
                    padding: 15,
                    width: 340,
                    maxWidth: "95%",
                  }}
                >
                  <div
                    style={{
                      color: "#f39c12",
                      fontSize: 14,
                      fontWeight: "bold",
                      marginBottom: 10,
                      textAlign: "center",
                    }}
                  >
                    🏆 Winning Cartela : {gameOver.winners[0].cardId}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(5, 1fr)",
                      gap: 4,
                      marginBottom: 4,
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
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
                    {gameOver.winners[0].card.map((row, r) =>
                      row.map((v, c) => {
                        const m = gameOver.winners[0].marked?.[r]?.[c];
                        const free = r === 2 && c === 2;
                        return (
                          <div
                            key={`${r}-${c}`}
                            style={{
                              aspectRatio: 1,
                              background: free ? "#4caf50" : m ? "#f39c12" : "#fff",
                              color: m || free ? "#fff" : "#1b2233",
                              fontSize: 14,
                              fontWeight: "bold",
                              borderRadius: 6,
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
              )}

              <p style={{ color: "#2ecc71", fontSize: 16, fontWeight: "bold", margin: 0 }}>
                💰 Prize Pool: {gameOver.prizePool} ETB
              </p>
            </>
          ) : (
            <p style={{ color: "#fff", fontSize: 16 }}>No winner this round.</p>
          )}

          {nextGameCountdown > 0 && (
            <div
              style={{
                background: "#1a1a2e",
                border: "1px solid #2a2a40",
                borderRadius: 20,
                padding: "8px 18px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#f39c12",
                  animation: "pulse 1s infinite",
                }}
              />
              <span style={{ color: "#fff", fontSize: 13 }}>
                Auto-starting next game in{" "}
                <b style={{ color: "#f39c12" }}>{nextGameCountdown}s</b>
              </span>
            </div>
          )}
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
      <div style={{ color: "#aaa", fontSize: 9, marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontSize: 12, fontWeight: "bold" }}>{value}</div>
    </div>
  );
}