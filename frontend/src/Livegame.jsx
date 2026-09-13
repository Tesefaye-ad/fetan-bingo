import React, { useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";
import BingoCard from "./Bingocard.jsx";

export default function LiveGame({ roomCode, onExit, setBalance, telegramId, cardId }) {
  const socketRef = useRef(null);
  const [card, setCard] = useState(null);
  const [marked, setMarked] = useState(null);
  const [status, setStatus] = useState("waiting");
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastNumber, setLastNumber] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [prizePool, setPrizePool] = useState(0);
  const [banner, setBanner] = useState("");
  const [gameOver, setGameOver] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    // የተመረጠውን cardId ጨምሮ ወደ ጨዋታ ክፍሉ ይገባል
    socket.emit("join_room", { roomCode, cardId });

    socket.on("your_card", ({ card, marked }) => {
      setCard(card);
      setMarked(marked);
    });

    socket.on("room_state", (state) => {
      setStatus(state.status);
      setPlayerCount(state.playerCount);
      setPrizePool(state.prizePool);
      setCalledNumbers(state.calledNumbers || []);
    });

    socket.on("game_started", () => {
      setStatus("active");
      setBanner("Game started! Numbers will be called automatically.");
    });

    socket.on("number_called", ({ number, calledNumbers }) => {
      setLastNumber(number);
      setCalledNumbers(calledNumbers);
    });

    socket.on("bingo_rejected", ({ message }) => setBanner(message));

    socket.on("game_over", (result) => {
      setStatus("finished");
      setGameOver(result);
    });

    socket.on("balance_update", ({ balance }) => setBalance(balance));

    socket.on("balance_update_for", ({ telegramId: winnerTgId, balance }) => {
      if (telegramId && String(winnerTgId) === String(telegramId)) {
        setBalance(balance);
      }
    });

    socket.on("error_message", ({ message }) => setBanner(message));

    return () => {
      socket.emit("leave_room");
      socket.off("your_card");
      socket.off("room_state");
      socket.off("game_started");
      socket.off("number_called");
      socket.off("bingo_rejected");
      socket.off("game_over");
      socket.off("balance_update");
      socket.off("balance_update_for");
      socket.off("error_message");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, cardId]);

  function handleCellClick(r, c) {
    if (status !== "active") return;
    socketRef.current.emit("mark_cell", { roomCode, row: r, col: c });
    // optimistic local update
    setMarked((prev) => {
      if (!prev) return prev;
      const copy = prev.map((row) => [...row]);
      copy[r][c] = true;
      return copy;
    });
  }

  function claimBingo() {
    socketRef.current.emit("claim_bingo", { roomCode });
  }

  return (
    <div className="live-game">
      <div className="game-header">
        <button className="back-btn" onClick={onExit}>
          ← Leave
        </button>
        <span>Room: {roomCode}</span>
        <span>{playerCount} players</span>
        <span>Pool: {prizePool} ETB</span>
      </div>

      {status === "waiting" && (
        <p className="hint">Waiting for at least one more player to join…</p>
      )}

      {banner && <p className="banner">{banner}</p>}

      {lastNumber && status === "active" && (
        <div className="last-number">Last called: {lastNumber}</div>
      )}

      <div className="called-numbers">
        {calledNumbers.map((n) => (
          <span key={n} className="chip">
            {n}
          </span>
        ))}
      </div>

      {/* የተመረጠውን cardId ወደ BingoCard component ያስተላልፋል */}
      <BingoCard card={card} marked={marked} onCellClick={handleCellClick} cardId={cardId} />

      {status === "active" && (
        <button className="bingo-btn" onClick={claimBingo}>
          BINGO!
        </button>
      )}

      {gameOver && (
        <div className="game-over-overlay">
          {gameOver.draw ? (
            <p>Round ended - no winner this time.</p>
          ) : (
            <p>
              🎉 {gameOver.winnerName} won with {gameOver.pattern}! Prize:{" "}
              {gameOver.prizePool} ETB
            </p>
          )}
          <button onClick={onExit}>Back to Lobby</button>
        </div>
      )}
    </div>
  );
}