import React, { useEffect, useState } from "react";
import { getRooms, createRoom } from "./api";
import { getSocket } from "./socket";

export default function GameLobby({ onJoin }) {
  const [rooms, setRooms] = useState([]);
  const [roomCode, setRoomCode] = useState("");
  const [cardId, setCardId] = useState(1);
  const [takenCards, setTakenCards] = useState({}); // የተያዙ ካርዶች መዝገብ
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      socket.off("room_state");
      socket.off("error_message");
    };
  }, []);

  function joinCode(code) {
    if (!code) return;
    const parsedCardId = parseInt(cardId, 10);
    
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

  async function handleCreateRoom() {
    setCreating(true);
    try {
      const room = await createRoom(10);
      joinCode(room.roomCode);
    } catch (err) {
      setCreating(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="lobby" style={{ padding: "15px", maxWidth: "450px", margin: "0 auto" }}>
      <h2 style={{ color: "#fff", textAlign: "center", marginBottom: "20px" }}>Join a Bingo Room</h2>

      {errorMessage && (
        <div style={{ background: "#e74c3c", color: "#fff", padding: "10px", borderRadius: "8px", marginBottom: "15px", fontSize: "13px", textAlign: "center" }}>
          {errorMessage}
        </div>
      )}

      {/* Join by Code & Card ID Selection */}
      <div className="join-by-code" style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "15px", background: "#1a1a2e", padding: "15px", borderRadius: "12px", border: "1px solid #2a2a40" }}>
        <div>
          <label style={{ display: "block", color: "#f39c12", fontSize: "12px", marginBottom: "5px" }}>Room Code:</label>
          <input
            placeholder="Room code (e.g. ROOM1)"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
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
          onClick={() => joinCode(roomCode)}
          style={{ width: "100%", background: "#2ecc71", color: "#fff", border: "none", borderRadius: "8px", padding: "12px", fontWeight: "bold", cursor: "pointer", fontSize: "14px" }}
        >
          Join Room
        </button>
      </div>

      <button 
        disabled={creating} 
        invoke={handleCreateRoom}
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
            onClick={() => setRoomCode(r.roomCode)}
            style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "10px", padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", color: "#fff" }}
          >
            <span style={{ fontWeight: "bold", color: "#f39c12" }}>{r.roomCode}</span>
            <span style={{ fontSize: "13px", color: "#aaa" }}>{r.playerCount} players</span>
            <span style={{ fontSize: "13px", color: "#2ecc71" }}>Entry: {r.entryFee} ETB</span>
            <span style={{ fontSize: "13px", color: "#3498db" }}>Pool: {r.prizePool} ETB</span>
          </li>
        ))}
      </ul>
    </div>
  );
}