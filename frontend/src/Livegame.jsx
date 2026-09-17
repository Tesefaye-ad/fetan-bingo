import React, { useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";
import BingoCard from "./Bingocard.jsx";

export default function LiveGame({ roomCode, onExit, setBalance, telegramId, cardIds }) {
  const socketRef = useRef(null);
  const joinedRef = useRef(false);
  const [cards, setCards] = useState([]);          // 👈 ብዙ ካርዶች
  const [markedCards, setMarkedCards] = useState([]); // 👈 ብዙ ካርዶች ምልክት
  const [status, setStatus] = useState("waiting");
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastNumber, setLastNumber] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [prizePool, setPrizePool] = useState(0);
  const [entryFee, setEntryFee] = useState(0);
  const [banner, setBanner] = useState("");
  const [gameOver, setGameOver] = useState(null);
  const [watching, setWatching] = useState(false);
  const [nextGameCountdown, setNextGameCountdown] = useState(0);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    if (!joinedRef.current) {
      // 👈 ብዙ ካርዶች ካሉ በ array ላካቸው
      const idsToSend = Array.isArray(cardIds) ? cardIds : (cardIds ? [cardIds] : []);
      socket.emit("join_room", { roomCode, cardIds: idsToSend });
      joinedRef.current = true;
    }

    // 👈 አዲሱ የ cards event
    socket.on("your_cards", ({ cards: c, markedCards: m }) => {
      setCards(c || []);
      setMarkedCards(m || []);
    });

    // የቆየው የ single card event (ለተመጣጣኝነት)
    socket.on("your_card", ({ card, marked }) => {
      setCards([card]);
      setMarkedCards([marked]);
    });

    socket.on("watching_mode", () => setWatching(true));

    socket.on("room_state", (state) => {
      setStatus(state.status);
      setPlayerCount(state.playerCount);
      setPrizePool(state.prizePool);
      setEntryFee(state.entryFee || 0);
      setCalledNumbers(state.calledNumbers || []);
    });

    socket.on("game_started", () => {
      setStatus("active");
      setBanner("🎯 Game started! Numbers will be called automatically.");
    });

    socket.on("number_called", ({ number, calledNumbers }) => {
      setLastNumber(number);
      setCalledNumbers(calledNumbers);
    });

    socket.on("bingo_rejected", ({ message }) => setBanner(message));

    socket.on("bingo_claimed", (data) => {
      setBanner(`🎉 BINGO! ${data.winners.map((w) => w.name).join(", ")} won!`);
    });

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
      setBanner("🎯 New game starting...");
      setLastNumber(null);
      setCalledNumbers([]);
      setNextGameCountdown(0);
    });

    socket.on("balance_update", ({ balance }) => setBalance(balance));
    socket.on("error_message", ({ message }) => setBanner(message));

    return () => {
      socket.emit("leave_room");
      joinedRef.current = false;
      [
        "your_cards", "your_card", "room_state", "game_started", "number_called",
        "bingo_rejected", "bingo_claimed", "game_over", "next_game_ready",
        "balance_update", "watching_mode", "error_message"
      ].forEach((e) => socket.off(e));
    };
  }, [roomCode, cardIds, setBalance]);

  useEffect(() => {
    if (nextGameCountdown <= 0) return;
    const t = setTimeout(() => setNextGameCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [nextGameCountdown]);

  // 👈 የካርድ ሴል ጠቅታ (በ cardIndex ይለያል)
  function handleCellClick(cardIndex, r, c) {
    if (status !== "active" || watching) return;
    socketRef.current.emit("mark_cell", { roomCode, row: r, col: c });
    setMarkedCards((prev) => {
      if (!prev || !prev[cardIndex]) return prev;
      const copy = prev.map((m) => m.map((row) => [...row]));
      copy[cardIndex][r][c] = true;
      return copy;
    });
  }

  function claimBingo() {
    if (watching) return;
    socketRef.current.emit("claim_bingo", { roomCode });
  }

  return (
    <div className="live-game" style={{ padding: "15px", maxWidth: "450px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "10px", flexWrap: "wrap", gap: "6px", background: "#1a1a2e", padding: "10px", borderRadius: "10px" }}>
        <div><div style={{ color: "#aaa", fontSize: "10px" }}>GAME ID</div><div style={{ color: "#f39c12", fontWeight: "bold" }}>{roomCode}</div></div>
        <div><div style={{ color: "#aaa", fontSize: "10px" }}>PLAYERS</div><div style={{ color: "#fff", fontWeight: "bold" }}>{playerCount}</div></div>
        <div><div style={{ color: "#aaa", fontSize: "10px" }}>BET</div><div style={{ color: "#fff", fontWeight: "bold" }}>{entryFee} ETB</div></div>
        <div><div style={{ color: "#aaa", fontSize: "10px" }}>DERASH</div><div style={{ color: "#2ecc71", fontWeight: "bold" }}>{prizePool} ETB</div></div>
        <div><div style={{ color: "#aaa", fontSize: "10px" }}>CALLED</div><div style={{ color: "#fff", fontWeight: "bold" }}>{calledNumbers.length}</div></div>
      </div>

      {watching && (
        <div style={{ background: "#3498db", color: "#fff", padding: "8px", borderRadius: "8px", textAlign: "center", fontSize: "12px", marginBottom: "10px" }}>
          👁 Watching Only Mode
        </div>
      )}

      {status === "waiting" && !watching && (
        <p style={{ color: "#aaa", fontSize: "13px", textAlign: "center" }}>Waiting for players to join…</p>
      )}

      {banner && <p style={{ background: "#2c3550", padding: "8px 12px", borderRadius: "8px", fontSize: "13px", marginBottom: "8px", color: "#fff" }}>{banner}</p>}

      {lastNumber && status === "active" && (
        <div style={{ textAlign: "center", margin: "10px 0" }}>
          <div style={{ color: "#aaa", fontSize: "11px" }}>LAST CALLED</div>
          <div style={{ fontSize: "42px", fontWeight: "bold", color: "#ffd43b" }}>{lastNumber}</div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "12px", maxHeight: "70px", overflowY: "auto" }}>
        {calledNumbers.map((n) => (
          <span key={n} style={{ background: "#333c52", borderRadius: "20px", padding: "2px 8px", fontSize: "12px", color: "#fff" }}>{n}</span>
        ))}
      </div>

      {/* 👈 ብዙ ካርዶች ማሳያ */}
      {cards.map((card, idx) => (
        <div key={idx} style={{ marginBottom: "20px", borderBottom: idx < cards.length - 1 ? "2px dashed #2a2a40" : "none", paddingBottom: "15px" }}>
          <BingoCard
            card={card}
            marked={markedCards[idx]}
            onCellClick={(r, c) => handleCellClick(idx, r, c)}
            cardId={cardIds[idx] || (Array.isArray(cardIds) ? cardIds[idx] : cardId)}
          />
        </div>
      ))}

      {status === "active" && !watching && cards.length > 0 && (
        <button onClick={claimBingo} style={{ display: "block", margin: "16px auto 0", background: "#f03e3e", color: "#fff", border: "none", borderRadius: "10px", padding: "14px 40px", fontSize: "18px", fontWeight: "bold", cursor: "pointer" }}>
          BINGO!
        </button>
      )}

      {gameOver && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "20px", gap: "16px", zIndex: 10 }}>
          <div style={{ fontSize: "32px" }}>🎉</div>
          <h2 style={{ color: "#f39c12", margin: 0 }}>BINGO!</h2>
          {gameOver.winners && gameOver.winners.length > 0 ? (
            <>
              <p style={{ color: "#fff", fontSize: "18px", margin: 0 }}>
                {gameOver.winners.length} player{gameOver.winners.length > 1 ? "s" : ""} won!
              </p>
              <div style={{ background: "#1a1a2e", borderRadius: "10px", padding: "15px", minWidth: "220px" }}>
                {gameOver.winners.map((w, i) => (
                  <div key={i} style={{ color: "#fff", fontSize: "14px", padding: "4px 0", borderBottom: i < gameOver.winners.length - 1 ? "1px solid #2a2a40" : "none" }}>
                    🏆 {w.name}
                  </div>
                ))}
              </div>
              <p style={{ color: "#2ecc71", fontSize: "16px", fontWeight: "bold", margin: 0 }}>
                Prize Pool: {gameOver.prizePool} ETB
              </p>
            </>
          ) : (
            <p style={{ color: "#fff" }}>No winner this round.</p>
          )}
          {nextGameCountdown > 0 && (
            <p style={{ color: "#aaa", fontSize: "14px" }}>
              Next game in <span style={{ color: "#f39c12", fontWeight: "bold" }}>{nextGameCountdown}s</span>
            </p>
          )}
          <button onClick={onExit} style={{ background: "#4c6ef5", color: "#fff", border: "none", borderRadius: "10px", padding: "12px 30px", fontWeight: "bold", cursor: "pointer" }}>
            Back to Lobby
          </button>
        </div>
      )}
    </div>
  );
}