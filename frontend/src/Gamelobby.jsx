import React, { useEffect, useState } from "react";
import { getRooms, createRoom } from "./api";
import { getSocket } from "./socket";

const STAKES = [
  { fee: 10, color: "#2ecc71" },
  { fee: 20, color: "#3498db" },
];

const WEEKLY_GAMES = [
  { fee: 50, color: "#3498db", schedule: "weekly (ቅዳሜ ማታ 12:00)" },
  { fee: 100, color: "#2ecc71", schedule: "weekly (ቅዳሜ ማታ 12:05)" },
];

export default function GameLobby({ onJoin, isAdmin, adminStats }) {
  const [rooms, setRooms] = useState([]);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [cardId, setCardId] = useState(1);
  const [takenCards, setTakenCards] = useState({}); // የተያዙ ካርዶች መዝገብ
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false); // room-code/manual create button
  const [quickPlayFee, setQuickPlayFee] = useState(null); // which stake button is loading
  const [errorMessage, setErrorMessage] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function load() {
      getRooms()
        .then((r) => {
          if (!cancelled) setRooms(r);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    const interval = setInterval(load, 5000);

    // ከሶኬት የተያዙ ካርዶችን መረጃ መቀበል
    const socket = getSocket();
    socket.on("room_state", (state) => {
      if (state.takenCards) {
        setTakenCards(state.takenCards);
      }
    });

    socket.on("error_message", ({ message }) => {
      setErrorMessage(message);
      setQuickPlayFee(null);
      setCreating(false);
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      socket.off("room_state");
      socket.off("error_message");
    };
  }, []);

  function joinCode(code, parsedCardId) {
    if (!code) return;

    // ካርዱ በሌላ ሰው መያዙን በደንበኛ በኩል ማረጋገጥ
    const isTakenByOther = Object.values(takenCards).includes(parsedCardId);
    if (isTakenByOther) {
      setErrorMessage("❌ ይህ ካርድ አስቀድሞ በሌላ ተጫዋች ተይዟል!");
      return;
    }

    if (!parsedCardId || parsedCardId < 1 || parsedCardId > 1000) {
      setErrorMessage("እባክዎ ትክክለኛ የካርድ ቁጥር ከ 1 እስከ 1000 መካከል ያስገቡ!");
      return;
    }

    setErrorMessage("");
    onJoin(code.trim().toUpperCase(), parsedCardId);
  }

  // "Play <fee> ETB" from the stake / weekly screens: creates a fresh room
  // at that entry fee and jumps straight in with a random card.
  async function handleQuickPlay(fee) {
    setErrorMessage("");
    setQuickPlayFee(fee);
    try {
      const room = await createRoom(fee);
      const randomCardId = Math.floor(Math.random() * 1000) + 1;
      joinCode(room.roomCode, randomCardId);
    } catch (err) {
      setErrorMessage("Could not start the game. Please try again.");
    } finally {
      setQuickPlayFee(null);
    }
  }

  async function handleCreateRoom() {
    setCreating(true);
    try {
      const room = await createRoom(10);
      joinCode(room.roomCode, parseInt(cardId, 10));
    } finally {
      setCreating(false);
    }
  }

  function stakeButtonStyle(color) {
    return {
      width: "100%",
      background: color,
      color: "#fff",
      border: "none",
      borderRadius: "10px",
      padding: "14px",
      fontWeight: "bold",
      fontSize: "15px",
      cursor: "pointer",
      marginBottom: "6px",
    };
  }

  return (
    <div className="lobby" style={{ padding: "15px", maxWidth: "450px", margin: "0 auto" }}>
      {errorMessage && (
        <div style={{ background: "#e74c3c", color: "#fff", padding: "10px", borderRadius: "8px", marginBottom: "15px", fontSize: "13px", textAlign: "center" }}>
          {errorMessage}
        </div>
      )}

      <h2 style={{ color: "#fff", textAlign: "center", marginBottom: "20px" }}>
        Welcome to <span style={{ color: "#f39c12" }}>Fetan Lottery</span>
      </h2>

      {/* ---- Choose Stake ---- */}
      <div style={{ border: "1px solid #f39c12", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
        <div style={{ color: "#f39c12", fontWeight: "bold", textAlign: "center", marginBottom: "12px" }}>
          Choose Stake
        </div>
        {STAKES.map((s) => (
          <button
            key={s.fee}
            disabled={quickPlayFee !== null}
            onClick={() => handleQuickPlay(s.fee)}
            style={stakeButtonStyle(s.color)}
          >
            {quickPlayFee === s.fee ? "Starting…" : `▶ Play ${s.fee} ETB`}
          </button>
        ))}
      </div>

      {/* ---- Weekly Game ---- */}
      <div style={{ border: "1px solid #f39c12", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
        <div style={{ color: "#f39c12", fontWeight: "bold", textAlign: "center", marginBottom: "12px" }}>
          Weekly Game
        </div>
        {WEEKLY_GAMES.map((g) => (
          <div key={g.fee} style={{ marginBottom: "10px" }}>
            <button
              disabled={quickPlayFee !== null}
              onClick={() => handleQuickPlay(g.fee)}
              style={{ ...stakeButtonStyle(g.color), marginBottom: "4px" }}
            >
              {quickPlayFee === g.fee ? "Starting…" : `▶ Play ${g.fee} ETB`}
            </button>
            <div style={{ color: "#f39c12", fontSize: "12px", textAlign: "center" }}>{g.schedule}</div>
          </div>
        ))}
      </div>

      {/* ---- Admin-only stats ---- */}
      {isAdmin && adminStats && (
        <div style={{ background: "#12121e", border: "1px solid #2a2a40", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
          <div style={{ textAlign: "center", marginBottom: "12px" }}>
            <div style={{ color: "#fff", fontSize: "24px", fontWeight: "bold" }}>{adminStats.activeUsers}</div>
            <div style={{ color: "#aaa", fontSize: "12px" }}>Active Users</div>
          </div>
          <hr style={{ border: "none", borderTop: "1px solid #2a2a40" }} />
          <div style={{ textAlign: "center", marginTop: "12px" }}>
            <div style={{ color: "#fff", fontSize: "24px", fontWeight: "bold" }}>{adminStats.registeredUsers}</div>
            <div style={{ color: "#aaa", fontSize: "12px" }}>Registered Users</div>
          </div>
        </div>
      )}

      {/* ---- Advanced: join by room code / browse open rooms ---- */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        style={{ width: "100%", background: "transparent", color: "#aaa", border: "1px solid #2a2a40", borderRadius: "10px", padding: "10px", fontSize: "13px", cursor: "pointer", marginBottom: showAdvanced ? "15px" : "0" }}
      >
        {showAdvanced ? "▲ Hide room code / browse rooms" : "▼ Join by room code / browse open rooms"}
      </button>

      {showAdvanced && (
        <>
          <div className="join-by-code" style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "15px", background: "#1a1a2e", padding: "15px", borderRadius: "12px", border: "1px solid #2a2a40" }}>
            <div>
              <label style={{ display: "block", color: "#f39c12", fontSize: "12px", marginBottom: "5px" }}>Room Code:</label>
              <input
                placeholder="Room code (e.g. ROOM1)"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value)}
                style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "10px", color: "#fff", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>

            <div>
              <label style={{ display: "block", color: "#f39c12", fontSize: "12px", marginBottom: "5px" }}>Choose Card ID (1 - 1000):</label>
              <input
                type="number"
                min="1"
                max="1000"
                placeholder="Card ID (1 - 1000)"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
                style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "10px", color: "#fff", fontSize: "14px", boxSizing: "border-box" }}
              />
              {/* የካርዱን ሁኔታ በቀይ ወይም አረንጓዴ ማሳየት */}
              <div style={{ marginTop: "5px", fontSize: "12px" }}>
                {Object.values(takenCards).includes(Number(cardId)) ? (
                  <span style={{ color: "#e74c3c", fontWeight: "bold" }}>🔴 ይህ ካርድ ተይዟል (Not Available)</span>
                ) : (
                  <span style={{ color: "#2ecc71", fontWeight: "bold" }}>🟢 ይህ ካርድ ክፍት ነው (Available)</span>
                )}
              </div>
            </div>

            <button
              onClick={() => joinCode(roomCodeInput, parseInt(cardId, 10))}
              style={{ width: "100%", background: "#2ecc71", color: "#fff", border: "none", borderRadius: "8px", padding: "12px", fontWeight: "bold", cursor: "pointer", fontSize: "14px" }}
            >
              Join Room
            </button>
          </div>

          <button
            disabled={creating}
            onClick={handleCreateRoom}
            style={{ width: "100%", background: "#f39c12", color: "#111", border: "none", borderRadius: "10px", padding: "12px", fontWeight: "bold", cursor: "pointer", fontSize: "14px", marginBottom: "20px" }}
          >
            {creating ? "Creating…" : "+ New Room (10 ETB entry)"}
          </button>

          <h3 style={{ color: "#fff", fontSize: "16px", marginBottom: "10px" }}>Open Rooms</h3>
          {loading && <p className="hint" style={{ color: "#aaa" }}>Loading rooms…</p>}
          {!loading && rooms.length === 0 && (
            <p className="hint" style={{ color: "#aaa" }}>No open rooms right now - create one above.</p>
          )}
          <ul className="room-list" style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {rooms.map((r) => (
              <li
                key={r.roomCode}
                onClick={() => joinCode(r.roomCode, parseInt(cardId, 10))}
                style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", color: "#fff" }}
              >
                <span style={{ fontWeight: "bold", color: "#f39c12" }}>{r.roomCode}</span>
                <span style={{ fontSize: "13px", color: "#aaa" }}>{r.playerCount} players</span>
                <span style={{ fontSize: "13px", color: "#2ecc71" }}>Entry: {r.entryFee} ETB</span>
                <span style={{ fontSize: "13px", color: "#3498db" }}>Pool: {r.prizePool} ETB</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
