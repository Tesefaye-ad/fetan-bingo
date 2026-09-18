import React, { useEffect, useRef, useState } from "react";
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

// 👈 3 ነጥብ animation component
function LoadingDots() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setActive((a) => (a + 1) % 3), 400);
    return () => clearInterval(timer);
  }, []);
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "10px" }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            background: active >= i ? "#e91e63" : "#3a3a55",
            transition: "background 0.3s",
          }}
        />
      ))}
    </div>
  );
}

export default function LiveGame({ roomCode, cardIds, onExit, setBalance, telegramId }) {
  const socketRef = useRef(null);
  const joinedRef = useRef(false);
  const [cards, setCards] = useState([]);
  const [status, setStatus] = useState("waiting");
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastNumber, setLastNumber] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [prizePool, setPrizePool] = useState(0);
  const [entryFee, setEntryFee] = useState(0);
  const [banner, setBanner] = useState("");
  const [gameOver, setGameOver] = useState(null);
  const [watching, setWatching] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  const [nextGameCountdown, setNextGameCountdown] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const [progress, setProgress] = useState(0);

  // ═══════════════════════════════════════════════════
  // Socket Setup
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    if (!joinedRef.current) {
      socket.emit("join_room", { roomCode, cardIds });
      joinedRef.current = true;
    }

    socket.on("your_cards", (data) => {
      if (data.cards && data.markedCards) {
        const combined = data.cards.map((card, idx) => ({
          cardId: data.cardIds ? data.cardIds[idx] : idx + 1,
          card,
          marked: data.markedCards[idx],
        }));
        setCards(combined);
      }
    });

    socket.on("watching_mode", () => setWatching(true));

    socket.on("room_state", (state) => {
      setStatus(state.status);
      setPlayerCount(state.playerCount);
      setPrizePool(state.prizePool);
      setEntryFee(state.entryFee || 0);
      setCalledNumbers(state.calledNumbers || []);
      if (state.calledNumbers && state.calledNumbers.length > 0) {
        setLastNumber(state.calledNumbers[state.calledNumbers.length - 1]);
      }
    });

    socket.on("game_started", () => {
      setStatus("active");
      setBanner("");
    });

    socket.on("number_called", ({ number, calledNumbers: cn }) => {
      setLastNumber(number);
      setCalledNumbers(cn);
      setProgress(0);
      setCards((prev) =>
        prev.map((ci) => {
          const newMarked = ci.marked.map((row) => [...row]);
          for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
              if (ci.card[r][c] === number) newMarked[r][c] = true;
            }
          }
          return { ...ci, marked: newMarked };
        })
      );
      if (soundOn && window.navigator.vibrate) window.navigator.vibrate(80);
    });

    socket.on("bingo_rejected", ({ message }) => setBanner(message));
    socket.on("bingo_claimed", (data) => {
      setBanner(`🎉 BINGO! ${data.winners.map((w) => w.name).join(", ")} won!`);
    });

    socket.on("game_over", (result) => {
      setStatus("finished");
      setGameOver(result);
      if (result.nextGameAt) {
        const remaining = Math.max(
          0,
          Math.floor((new Date(result.nextGameAt) - Date.now()) / 1000)
        );
        setNextGameCountdown(remaining);
      }
    });

    socket.on("next_game_ready", () => {
      setGameOver(null);
      setBanner("");
      setLastNumber(null);
      setCalledNumbers([]);
      setNextGameCountdown(0);
      setStatus("waiting");
    });

    socket.on("balance_update", ({ balance }) => setBalance(balance));
    socket.on("error_message", ({ message }) => {
      if (!message.includes("Insufficient")) setBanner(message);
    });

    return () => {
      socket.emit("leave_room");
      joinedRef.current = false;
      [
        "your_cards", "room_state", "game_started", "number_called",
        "bingo_rejected", "bingo_claimed", "game_over", "next_game_ready",
        "balance_update", "watching_mode", "error_message",
      ].forEach((e) => socket.off(e));
    };
  }, [roomCode, cardIds, setBalance, soundOn]);

  // Next game countdown
  useEffect(() => {
    if (nextGameCountdown <= 0) return;
    const t = setTimeout(() => setNextGameCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [nextGameCountdown]);

  // Progress bar for next number (visual effect)
  useEffect(() => {
    if (status !== "active") {
      setProgress(0);
      return;
    }
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) return 0;
        return p + 2.5;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [status]);

  const handleCellClick = (cardIndex, r, c) => {
    if (status !== "active" || watching || autoMode) return;
    socketRef.current.emit("mark_cell", { roomCode, row: r, col: c });
  };

  const claimBingo = () => {
    if (watching) return;
    socketRef.current.emit("claim_bingo", { roomCode });
  };

  const refreshRoom = () => {
    socketRef.current.emit("join_room", { roomCode, cardIds });
  };

  const lastInfo = lastNumber ? getLetter(lastNumber) : null;

  return (
    <div
      style={{
        padding: "8px",
        maxWidth: "480px",
        margin: "0 auto",
        color: "#fff",
        minHeight: "100vh",
        background: "#0f1420",
        display: "flex",
        flexDirection: "column",
        paddingBottom: "80px",
      }}
    >
      {/* ═══ TOP STATS BAR ═══ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "4px",
          marginBottom: "8px",
        }}
      >
        {[
          { label: "Game ID", value: roomCode, color: "#f39c12" },
          { label: "Players", value: playerCount, color: "#fff" },
          { label: "Bet", value: entryFee, color: "#fff" },
          { label: "Derash", value: prizePool, color: "#2ecc71" },
          { label: "Called", value: calledNumbers.length, color: "#fff" },
        ].map((item, i) => (
          <div
            key={i}
            style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a40",
              borderRadius: "8px",
              padding: "6px 4px",
              textAlign: "center",
            }}
          >
            <div style={{ color: "#aaa", fontSize: "9px", marginBottom: "2px" }}>
              {item.label}
            </div>
            <div
              style={{
                color: item.color,
                fontSize: "12px",
                fontWeight: "bold",
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {/* Banner */}
      {banner && (
        <div
          style={{
            background: "#2c3550",
            padding: "6px 10px",
            borderRadius: "8px",
            fontSize: "12px",
            marginBottom: "8px",
            color: "#fff",
            textAlign: "center",
          }}
        >
          {banner}
        </div>
      )}

      {/* ═══ MAIN GRID ═══ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px",
          flex: 1,
          marginBottom: "8px",
        }}
      >
        {/* ═══ LEFT: Bingo Card Grid ═══ */}
        <div
          style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a40",
            borderRadius: "10px",
            padding: "6px",
            overflowY: "auto",
            maxHeight: "calc(100vh - 180px)",
          }}
        >
          {/* B-I-N-G-O Headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: "3px",
              marginBottom: "3px",
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
                  fontSize: "14px",
                  padding: "6px 0",
                  borderRadius: "6px",
                }}
              >
                {h.letter}
              </div>
            ))}
          </div>

          {/* 1-75 Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: "3px",
            }}
          >
            {Array.from({ length: 75 }, (_, i) => i + 1).map((num) => {
              const info = getLetter(num);
              const isCalled = calledNumbers.includes(num);
              const isLast = lastNumber === num;
              return (
                <div
                  key={num}
                  style={{
                    aspectRatio: "1",
                    background: isLast
                      ? "#ff9800"
                      : isCalled
                      ? info.color
                      : "#252d44",
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: "bold",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: isLast ? "2px solid #ffd43b" : "1px solid #333",
                    transition: "background 0.3s",
                  }}
                >
                  {num}
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ RIGHT: Side Panel ═══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {/* Get Ready + Progress */}
          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a40",
              borderRadius: "10px",
              padding: "12px 10px",
              position: "relative",
              minHeight: "110px",
            }}
          >
            <button
              onClick={() => setSoundOn((s) => !s)}
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                background: "transparent",
                border: "none",
                color: soundOn ? "#ffd43b" : "#666",
                fontSize: "18px",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {soundOn ? "🔊" : "🔇"}
            </button>

            {lastInfo ? (
              <>
                <LoadingDots />
                <div
                  style={{
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: "bold",
                    textAlign: "center",
                    marginBottom: "12px",
                    lineHeight: "1.4",
                  }}
                >
                  Get ready for the next number!
                </div>
                <div
                  style={{
                    background: "#fff",
                    color: lastInfo.color,
                    borderRadius: "50%",
                    width: "60px",
                    height: "60px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                    fontSize: "20px",
                    margin: "0 auto 10px auto",
                    border: "3px solid #f39c12",
                    boxShadow: "0 0 20px rgba(243,156,18,0.5)",
                  }}
                >
                  {lastInfo.letter}-{lastNumber}
                </div>
              </>
            ) : (
              <>
                <LoadingDots />
                <div
                  style={{
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: "bold",
                    textAlign: "center",
                    marginBottom: "12px",
                    lineHeight: "1.4",
                  }}
                >
                  Get ready for the next number!
                </div>
              </>
            )}

            {/* Progress Bar */}
            <div
              style={{
                background: "#2a2a40",
                borderRadius: "10px",
                height: "6px",
                overflow: "hidden",
                marginTop: "6px",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #e91e63, #9c27b0)",
                  transition: "width 0.1s linear",
                  borderRadius: "10px",
                }}
              />
            </div>
          </div>

          {/* Automatic Toggle */}
          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a40",
              borderRadius: "10px",
              padding: "10px 12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "13px", color: "#fff" }}>Automatic</span>
            <div
              onClick={() => setAutoMode((a) => !a)}
              style={{
                width: "40px",
                height: "22px",
                background: autoMode ? "#2ecc71" : "#444",
                borderRadius: "11px",
                position: "relative",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <div
                style={{
                  width: "18px",
                  height: "18px",
                  background: "#fff",
                  borderRadius: "50%",
                  position: "absolute",
                  top: "2px",
                  left: autoMode ? "20px" : "2px",
                  transition: "all 0.2s",
                }}
              />
            </div>
          </div>

          {/* Watching Only / Status Box */}
          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a40",
              borderRadius: "10px",
              padding: "16px 12px",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              minHeight: "200px",
            }}
          >
            {watching ? (
              <>
                <div
                  style={{
                    color: "#fff",
                    fontSize: "17px",
                    fontWeight: "bold",
                    textAlign: "center",
                    marginBottom: "16px",
                  }}
                >
                  Watching Only
                </div>
                <div
                  style={{
                    color: "#aaa",
                    fontSize: "12px",
                    textAlign: "center",
                    lineHeight: "1.9",
                  }}
                >
                  የእርስዎ ካርቴላ<br />
                  ተጨምሯል:: አዲስ ቁጥር<br />
                  እስኪጠራ ድረስ<br />
                  ይጠብቁ::
                </div>
              </>
            ) : status === "waiting" ? (
              <div
                style={{
                  color: "#f39c12",
                  fontSize: "13px",
                  textAlign: "center",
                  lineHeight: "1.8",
                }}
              >
                🎯 ተጫዋቾች<br />እስኪገቡ ድረስ<br />በመጠበቅ ላይ...
              </div>
            ) : status === "active" ? (
              <div
                style={{
                  color: "#2ecc71",
                  fontSize: "14px",
                  textAlign: "center",
                  lineHeight: "1.8",
                }}
              >
                🎯 ጨዋታው<br />በሂደት ላይ ነው
              </div>
            ) : status === "finished" ? (
              <div
                style={{
                  color: "#f39c12",
                  fontSize: "14px",
                  textAlign: "center",
                  lineHeight: "1.8",
                }}
              >
                🏁 ጨዋታው<br />ተጠናቅቋል
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ═══ BOTTOM BUTTONS ═══ */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          maxWidth: "480px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1.4fr",
          gap: "8px",
          padding: "10px 12px",
          background: "#0f1420",
          borderTop: "1px solid #2a2a40",
        }}
      >
        <button
          onClick={onExit}
          style={{
            background: "linear-gradient(135deg, #e74c3c, #c0392b)",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            padding: "14px 0",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          Leave
        </button>
        <button
          onClick={refreshRoom}
          style={{
            background: "#3a3a55",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            padding: "14px 0",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            opacity: 0.85,
          }}
        >
          🔄 Refresh
        </button>
        <button
          onClick={() => setAutoMode((a) => !a)}
          style={{
            background: autoMode
              ? "linear-gradient(135deg, #d4a017, #b8860b)"
              : "#444",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            padding: "14px 0",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          Automatic
        </button>
      </div>

      {/* ═══ GAME OVER OVERLAY ═══ */}
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
            textAlign: "center",
            padding: "20px 15px",
            gap: "12px",
            zIndex: 100,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              width: "70px",
              height: "70px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #f39c12, #e67e22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "38px",
              boxShadow: "0 0 40px rgba(243,156,18,0.7)",
              marginTop: "20px",
            }}
          >
            👑
          </div>

          <h2
            style={{
              color: "#f39c12",
              margin: 0,
              fontSize: "36px",
              letterSpacing: "3px",
              fontWeight: "bold",
            }}
          >
            BINGO!
          </h2>

          {gameOver.winners && gameOver.winners.length > 0 ? (
            <>
              <p
                style={{
                  color: "#fff",
                  fontSize: "20px",
                  margin: 0,
                  fontWeight: "bold",
                }}
              >
                🎉 {gameOver.winners[0].name} WON! 🎉
              </p>

              {gameOver.winners[0].card && (
                <div
                  style={{
                    background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
                    border: "2px solid #f39c12",
                    borderRadius: "16px",
                    padding: "15px",
                    maxWidth: "95%",
                    width: "380px",
                  }}
                >
                  <div
                    style={{
                      color: "#f39c12",
                      fontSize: "14px",
                      fontWeight: "bold",
                      marginBottom: "10px",
                    }}
                  >
                    🏆 Winning Cartela : {gameOver.winners[0].cardId}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(5, 1fr)",
                      gap: "4px",
                      marginBottom: "4px",
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
                          fontSize: "14px",
                          padding: "6px 0",
                          borderRadius: "6px",
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
                      gap: "4px",
                    }}
                  >
                    {gameOver.winners[0].card.map((row, r) =>
                      row.map((value, c) => {
                        const isMarked = gameOver.winners[0].marked?.[r]?.[c];
                        const isFree = r === 2 && c === 2;
                        return (
                          <div
                            key={`${r}-${c}`}
                            style={{
                              aspectRatio: "1",
                              background: isFree
                                ? "#4caf50"
                                : isMarked
                                ? "#f39c12"
                                : "#fff",
                              color: isMarked || isFree ? "#fff" : "#1b2233",
                              fontSize: "14px",
                              fontWeight: "bold",
                              borderRadius: "6px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              border: "1px solid #ddd",
                            }}
                          >
                            {isFree ? "★" : value}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              <p
                style={{
                  color: "#2ecc71",
                  fontSize: "16px",
                  fontWeight: "bold",
                  margin: 0,
                }}
              >
                💰 Prize Pool: {gameOver.prizePool} ETB
              </p>
            </>
          ) : (
            <p style={{ color: "#fff", fontSize: "16px" }}>
              No winner this round.
            </p>
          )}

          {nextGameCountdown > 0 && (
            <div
              style={{
                background: "#1a1a2e",
                border: "1px solid #2a2a40",
                borderRadius: "20px",
                padding: "8px 18px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#f39c12",
                }}
              />
              <span style={{ color: "#fff", fontSize: "13px" }}>
                Auto-starting next game in{" "}
                <b style={{ color: "#f39c12" }}>{nextGameCountdown}s</b>
              </span>
            </div>
          )}

          <button
            onClick={onExit}
            style={{
              background: "linear-gradient(135deg, #4c6ef5, #364fc7)",
              color: "#fff",
              border: "none",
              borderRadius: "12px",
              padding: "12px 40px",
              fontWeight: "bold",
              cursor: "pointer",
              fontSize: "14px",
              marginTop: "8px",
              marginBottom: "20px",
            }}
          >
            Back to Lobby
          </button>
        </div>
      )}
    </div>
  );
}