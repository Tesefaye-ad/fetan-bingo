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

    socket.on("number_called", ({ number, calledNumbers }) => {
      setLastNumber(number);
      setCalledNumbers(calledNumbers);
      setCards((prevCards) =>
        prevCards.map((cardItem) => {
          const newMarked = cardItem.marked.map((row) => [...row]);
          for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
              if (cardItem.card[r][c] === number) newMarked[r][c] = true;
            }
          }
          return { ...cardItem, marked: newMarked };
        })
      );
      if (soundOn && window.navigator.vibrate) window.navigator.vibrate(100);
    });

    socket.on("bingo_rejected", ({ message }) => setBanner(message));
    socket.on("bingo_claimed", (data) =>
      setBanner(`🎉 BINGO! ${data.winners.map((w) => w.name).join(", ")} won!`)
    );

    socket.on("game_over", (result) => {
      setStatus("finished");
      setGameOver(result);
      if (result.nextGameAt) {
        const remaining = Math.max(0, Math.floor((new Date(result.nextGameAt) - Date.now()) / 1000));
        setNextGameCountdown(remaining);
      }
    });

    socket.on("next_game_ready", () => {
      setGameOver(null);
      setBanner("");
      setLastNumber(null);
      setCalledNumbers([]);
      setNextGameCountdown(0);
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
        "balance_update", "watching_mode", "error_message"
      ].forEach((e) => socket.off(e));
    };
  }, [roomCode, cardIds, setBalance, soundOn]);

  useEffect(() => {
    if (nextGameCountdown <= 0) return;
    const t = setTimeout(() => setNextGameCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [nextGameCountdown]);

  function handleCellClick(cardIndex, r, c) {
    if (status !== "active" || watching) return;
    if (!autoMode) socketRef.current.emit("mark_cell", { roomCode, row: r, col: c });
  }

  function claimBingo() {
    if (watching) return;
    socketRef.current.emit("claim_bingo", { roomCode });
  }

  const recentNumbers = calledNumbers.slice(-5).reverse();
  const lastNumberInfo = lastNumber ? getLetter(lastNumber) : null;

  return (
    <div style={{ padding: "8px", maxWidth: "480px", margin: "0 auto", color: "#fff", minHeight: "100vh", background: "#0f1420", display: "flex", flexDirection: "column" }}>
      {/* ═══ Top Info Bar ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px", marginBottom: "8px" }}>
        {[
          { label: "GAME ID", value: roomCode, color: "#f39c12" },
          { label: "PLAYERS", value: playerCount, color: "#fff" },
          { label: "BET", value: entryFee, color: "#fff" },
          { label: "DERASH", value: prizePool, color: "#2ecc71" },
          { label: "CALLED", value: calledNumbers.length, color: "#fff" },
        ].map((item, i) => (
          <div key={i} style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "8px", padding: "6px 4px", textAlign: "center" }}>
            <div style={{ color: "#aaa", fontSize: "9px", marginBottom: "2px" }}>{item.label}</div>
            <div style={{ color: item.color, fontSize: "11px", fontWeight: "bold" }}>{item.value}</div>
          </div>
        ))}
      </div>

      {banner && (
        <div style={{ background: "#2c3550", padding: "6px 10px", borderRadius: "8px", fontSize: "12px", marginBottom: "8px", color: "#fff", textAlign: "center" }}>
          {banner}
        </div>
      )}

      {/* ═══ Main Content ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", flex: 1, marginBottom: "8px" }}>
        {/* Left: Bingo Card or Watching View */}
        <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "6px", overflowY: "auto", minHeight: "300px" }}>
          {cards.length === 0 ? (
            <div style={{ padding: "10px", textAlign: "center" }}>
              {watching ? (
                <>
                  <div style={{ fontSize: "40px", marginBottom: "8px" }}>👁</div>
                  <div style={{ color: "#fff", fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>
                    Watching Only
                  </div>
                  <div style={{ color: "#aaa", fontSize: "11px", lineHeight: "1.7", marginBottom: "15px" }}>
                    የእርስዎ ካርቴላ የለም:: አዲስ ቁጥር እስኪጠራ ድረስ ይጠብቁ::
                  </div>

                  {/* የተጠሩ ቁጥሮች ዝርዝር */}
                  <div style={{ background: "#0f1420", border: "1px solid #2a2a40", borderRadius: "8px", padding: "8px", marginBottom: "10px", textAlign: "left" }}>
                    <div style={{ color: "#f39c12", fontSize: "11px", fontWeight: "bold", marginBottom: "6px" }}>
                      📞 የተጠሩ ቁጥሮች ({calledNumbers.length})
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {calledNumbers.length === 0 ? (
                        <span style={{ color: "#666", fontSize: "10px" }}>ገና አልተጠሩም</span>
                      ) : (
                        calledNumbers.slice(-20).reverse().map((n) => {
                          const info = getLetter(n);
                          return (
                            <span key={n} style={{
                              background: info.color,
                              color: "#fff",
                              borderRadius: "50%",
                              width: "26px",
                              height: "26px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "10px",
                              fontWeight: "bold",
                            }}>
                              {n}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* የመጨረሻው ቁጥር ማሳያ */}
                  {lastNumber && lastNumberInfo && (
                    <div style={{ background: "linear-gradient(135deg, #2a2a40, #1a1a2e)", border: "1px solid #f39c12", borderRadius: "10px", padding: "10px", marginBottom: "10px" }}>
                      <div style={{ color: "#aaa", fontSize: "10px", marginBottom: "6px" }}>LAST CALLED</div>
                      <div style={{
                        background: "#fff",
                        color: lastNumberInfo.color,
                        borderRadius: "50%",
                        width: "55px",
                        height: "55px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: "bold",
                        fontSize: "18px",
                        margin: "0 auto",
                        border: "3px solid #f39c12",
                        boxShadow: "0 0 20px rgba(243, 156, 18, 0.5)",
                      }}>
                        {lastNumberInfo.letter}-{lastNumber}
                      </div>
                    </div>
                  )}

                  {status === "waiting" && (
                    <div style={{ color: "#f39c12", fontSize: "11px" }}>
                      🎯 ተጫዋቾች እስኪገቡ በመጠበቅ ላይ...
                    </div>
                  )}
                  {status === "active" && (
                    <div style={{ color: "#2ecc71", fontSize: "11px" }}>
                      🎯 ጨዋታው በሂደት ላይ ነው
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: "#888", fontSize: "11px", padding: "40px 0" }}>
                  Waiting for card…
                </div>
              )}
            </div>
          ) : (
            cards.map((cardItem, cardIdx) => (
              <div key={cardIdx} style={{ marginBottom: cards.length > 1 ? "10px" : 0 }}>
                <div style={{ textAlign: "center", color: "#f39c12", fontSize: "10px", fontWeight: "bold", marginBottom: "4px" }}>
                  #{cardItem.cardId}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "2px", marginBottom: "2px" }}>
                  {HEADERS.map((h) => (
                    <div key={h.letter} style={{ background: h.color, color: "#fff", textAlign: "center", fontWeight: "bold", fontSize: "12px", padding: "4px 0", borderRadius: "4px" }}>
                      {h.letter}
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "2px" }}>
                  {cardItem.card.map((row, r) =>
                    row.map((value, c) => {
                      const isMarked = cardItem.marked?.[r]?.[c];
                      const isFree = r === 2 && c === 2;
                      const isLastCalled = !isFree && lastNumber === value;
                      return (
                        <button
                          key={`${r}-${c}`}
                          onClick={() => handleCellClick(cardIdx, r, c)}
                          style={{
                            aspectRatio: "1",
                            background: isFree
                              ? "#ffd43b"
                              : isLastCalled
                              ? "#ff9800"
                              : isMarked
                              ? "#4c6ef5"
                              : "#252d44",
                            color: isFree ? "#1b2233" : "#fff",
                            fontSize: "12px",
                            fontWeight: "bold",
                            borderRadius: "5px",
                            border: isLastCalled ? "2px solid #ffd43b" : "1px solid #333",
                            cursor: isFree ? "default" : "pointer",
                            padding: 0,
                          }}
                        >
                          {isFree ? "★" : value}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right: Called Numbers + Current */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {/* Recent Numbers */}
          <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "8px", minHeight: "50px", display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "flex-start", position: "relative" }}>
            {recentNumbers.length === 0 ? (
              <div style={{ color: "#666", fontSize: "10px", width: "100%", textAlign: "center", padding: "10px 0" }}>
                ቁጥሮች ሲጠሩ እዚህ ይታያሉ
              </div>
            ) : (
              recentNumbers.map((n, i) => {
                const info = getLetter(n);
                return (
                  <div key={`${n}-${i}`} style={{
                    background: info.color,
                    color: "#fff",
                    borderRadius: "50%",
                    width: "30px",
                    height: "30px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                    fontSize: "11px",
                  }}>
                    {info.letter}{n}
                  </div>
                );
              })
            )}
            <button
              onClick={() => setSoundOn((s) => !s)}
              style={{
                position: "absolute",
                top: "6px",
                right: "6px",
                background: "transparent",
                border: "none",
                color: soundOn ? "#ffd43b" : "#666",
                fontSize: "16px",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {soundOn ? "🔊" : "🔇"}
            </button>
          </div>

          {/* Current Number */}
          <div style={{ background: "linear-gradient(135deg, #2a2a40, #1a1a2e)", border: "1px solid #f39c12", borderRadius: "10px", padding: "12px", textAlign: "center" }}>
            <div style={{ color: "#aaa", fontSize: "10px", marginBottom: "4px" }}>CURRENT</div>
            {lastNumber && lastNumberInfo ? (
              <div style={{
                background: "#fff",
                color: lastNumberInfo.color,
                borderRadius: "50%",
                width: "70px",
                height: "70px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "bold",
                fontSize: "24px",
                margin: "0 auto",
                border: "4px solid #f39c12",
                boxShadow: "0 0 20px rgba(243, 156, 18, 0.5)",
              }}>
                {lastNumberInfo.letter}-{lastNumber}
              </div>
            ) : (
              <div style={{ color: "#666", fontSize: "14px", padding: "20px 0" }}>በመጠበቅ ላይ...</div>
            )}
          </div>

          {/* Automatic Toggle */}
          <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "#fff" }}>Automatic</span>
            <div
              onClick={() => setAutoMode((a) => !a)}
              style={{
                width: "36px",
                height: "20px",
                background: autoMode ? "#2ecc71" : "#444",
                borderRadius: "10px",
                position: "relative",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <div style={{
                width: "16px",
                height: "16px",
                background: "#fff",
                borderRadius: "50%",
                position: "absolute",
                top: "2px",
                left: autoMode ? "18px" : "2px",
                transition: "all 0.2s",
              }} />
            </div>
          </div>

          {/* Status Box */}
          <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "12px", flex: 1, overflowY: "auto" }}>
            {watching ? (
              <>
                <div style={{ color: "#fff", fontSize: "14px", fontWeight: "bold", textAlign: "center", marginBottom: "8px" }}>
                  👁 Watching Only
                </div>
                <div style={{ color: "#aaa", fontSize: "11px", textAlign: "center", lineHeight: "1.5" }}>
                  የእርስዎ ካርቴላ የለም። አዲስ ቁጥር እስኪጠራ ድረስ ይጠብቁ::
                </div>
              </>
            ) : status === "waiting" ? (
              <div style={{ color: "#aaa", fontSize: "11px", textAlign: "center", padding: "20px 0" }}>
                ተጫዋቾች እስኪገቡ በመጠበቅ ላይ...
              </div>
            ) : status === "active" ? (
              <div style={{ color: "#2ecc71", fontSize: "11px", textAlign: "center", padding: "20px 0" }}>
                🎯 ጨዋታው በሂደት ላይ ነው
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ═══ Bottom Buttons ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "8px" }}>
        <button
          onClick={onExit}
          style={{
            background: "linear-gradient(135deg, #e74c3c, #c0392b)",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            padding: "14px 0",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          Leave
        </button>
        <button
          onClick={() => socketRef.current.emit("join_room", { roomCode, cardIds })}
          style={{
            background: "linear-gradient(135deg, #e67e22, #d35400)",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            padding: "14px 0",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            opacity: 0.8,
          }}
        >
          🔄 Refresh
        </button>
        <button
          onClick={claimBingo}
          disabled={watching || status !== "active"}
          style={{
            background: watching || status !== "active" ? "#555" : "linear-gradient(135deg, #f39c12, #e67e22)",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            padding: "14px 0",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: watching || status !== "active" ? "not-allowed" : "pointer",
          }}
        >
          BINGO!
        </button>
      </div>

      {/* ═══ Game Over Overlay — Winner Announcement ═══ */}
      {gameOver && (
        <div style={{
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
        }}>
          {/* Crown */}
          <div style={{
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
          }}>
            👑
          </div>

          <h2 style={{
            color: "#f39c12",
            margin: 0,
            fontSize: "36px",
            letterSpacing: "3px",
            fontWeight: "bold",
          }}>
            BINGO!
          </h2>

          {gameOver.winners && gameOver.winners.length > 0 ? (
            <>
              {/* 👈 የአሸናፊው ስም */}
              <p style={{
                color: "#fff",
                fontSize: "20px",
                margin: 0,
                fontWeight: "bold",
              }}>
                🎉 {gameOver.winners[0].name} WON! 🎉
              </p>

              {/* 👈 የአሸናፊው ሙሉ ካርቴላ */}
              <div style={{
                background: "linear-gradient(135deg, #1a1a2e, #0f1420)",
                border: "2px solid #f39c12",
                borderRadius: "16px",
                padding: "15px",
                maxWidth: "95%",
                width: "380px",
                boxShadow: "0 0 30px rgba(243,156,18,0.3)",
              }}>
                <div style={{
                  color: "#f39c12",
                  fontSize: "14px",
                  fontWeight: "bold",
                  marginBottom: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}>
                  🏆 Winning Cartela : {gameOver.winners[0].cardId}
                </div>

                {/* B-I-N-G-O Headers */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px", marginBottom: "4px" }}>
                  {[
                    { l: "B", c: "#4c6ef5" },
                    { l: "I", c: "#9c27b0" },
                    { l: "N", c: "#e91e63" },
                    { l: "G", c: "#4caf50" },
                    { l: "O", c: "#ff9800" },
                  ].map((h) => (
                    <div key={h.l} style={{
                      background: h.c,
                      color: "#fff",
                      textAlign: "center",
                      fontWeight: "bold",
                      fontSize: "14px",
                      padding: "6px 0",
                      borderRadius: "6px",
                    }}>
                      {h.l}
                    </div>
                  ))}
                </div>

                {/* Cartela Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px" }}>
                  {gameOver.winners[0].card?.map((row, r) =>
                    row.map((value, c) => {
                      const isMarked = gameOver.winners[0].marked?.[r]?.[c];
                      const isFree = r === 2 && c === 2;
                      return (
                        <div
                          key={`${r}-${c}`}
                          style={{
                            aspectRatio: "1",
                            background: isFree ? "#4caf50" : isMarked ? "#f39c12" : "#fff",
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

              {/* 👈 ሌሎች አሸናፊዎች ካሉ */}
              {gameOver.winners.length > 1 && (
                <div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  justifyContent: "center",
                  maxWidth: "95%",
                }}>
                  {gameOver.winners.slice(1).map((w, i) => (
                    <div key={i} style={{
                      background: "#1a1a2e",
                      border: "1px solid #f39c12",
                      borderRadius: "20px",
                      padding: "5px 12px",
                      fontSize: "11px",
                      color: "#fff",
                    }}>
                      🏆 {w.name} #{w.cardId}
                    </div>
                  ))}
                </div>
              )}

              {/* 👈 የሽልማት መጠን */}
              <p style={{
                color: "#2ecc71",
                fontSize: "16px",
                fontWeight: "bold",
                margin: 0,
              }}>
                💰 Prize Pool: {gameOver.prizePool} ETB
              </p>
            </>
          ) : (
            <p style={{ color: "#fff", fontSize: "16px" }}>No winner this round.</p>
          )}

          {/* 👈 የሚቀጥለው ጨዋታ ቆጣሪ */}
          {nextGameCountdown > 0 && (
            <div style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a40",
              borderRadius: "20px",
              padding: "8px 18px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}>
              <div style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "#f39c12",
                animation: "pulse 1s infinite",
              }} />
              <span style={{ color: "#fff", fontSize: "13px" }}>
                Auto-starting next game in <b style={{ color: "#f39c12" }}>{nextGameCountdown}s</b>
              </span>
            </div>
          )}

          {/* 👈 ወደ Lobby መመለሻ */}
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