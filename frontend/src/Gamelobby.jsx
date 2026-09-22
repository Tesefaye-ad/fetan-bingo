import { useState, useEffect } from "react";
import { createRoom, getLeaderboard } from "./api";

const STAKES = [
  { fee: 10, color: "#2ecc71" },
  { fee: 20, color: "#3498db" },
];

const WEEKLY_GAMES = [
  { fee: 50, color: "#3498db", schedule: "ቅዳሜ ማታ 12:00" },
  { fee: 100, color: "#2ecc71", schedule: "ቅዳሜ ማታ 12:05" },
];

const SHARED_ROOMS = { 10: "ROOM10", 20: "ROOM20", 50: "ROOM50", 100: "ROOM100" };

export default function GameLobby({ onPlayStake, isAdmin }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState("");
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState(null);

  useEffect(() => {
    if (showLeaderboard && !leaderboard) {
      getLeaderboard()
        .then(setLeaderboard)
        .catch(() => {});
    }
  }, [showLeaderboard, leaderboard]);

  async function play(fee) {
    setLoading(fee);
    setError("");
    try {
      const room = await createRoom(fee, SHARED_ROOMS[fee]);
      onPlayStake(fee, room.roomCode);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Could not start");
    } finally {
      setLoading(null);
    }
  }

  const btn = (color) => ({
    width: "100%",
    background: color,
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: 14,
    fontWeight: "bold",
    fontSize: 15,
    cursor: "pointer",
    marginBottom: 6,
  });

  return (
    <div style={{ padding: 15, maxWidth: 450, margin: "0 auto" }}>
      {error && (
        <div
          style={{
            background: "#e74c3c",
            color: "#fff",
            padding: 10,
            borderRadius: 8,
            marginBottom: 15,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      <h2 style={{ color: "#fff", textAlign: "center", marginBottom: 20 }}>
        Welcome to <span style={{ color: "#f39c12" }}>Fetan Bingo</span>
      </h2>

      {/* Choose Stake */}
      <div
        style={{
          border: "1px solid #f39c12",
          borderRadius: 14,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            color: "#f39c12",
            fontWeight: "bold",
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          Choose Stake
        </div>
        {STAKES.map((s) => (
          <button
            key={s.fee}
            disabled={loading !== null}
            onClick={() => play(s.fee)}
            style={btn(s.color)}
          >
            {loading === s.fee ? "Starting…" : `▶ Play ${s.fee} ETB`}
          </button>
        ))}
      </div>

      {/* Weekly Game */}
      <div
        style={{
          border: "1px solid #f39c12",
          borderRadius: 14,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            color: "#f39c12",
            fontWeight: "bold",
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          Weekly Game
        </div>
        {WEEKLY_GAMES.map((g) => (
          <div key={g.fee} style={{ marginBottom: 10 }}>
            <button
              disabled={loading !== null}
              onClick={() => play(g.fee)}
              style={{ ...btn(g.color), marginBottom: 4 }}
            >
              {loading === g.fee ? "Starting…" : `▶ Play ${g.fee} ETB`}
            </button>
            <div
              style={{
                color: "#f39c12",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              {g.schedule}
            </div>
          </div>
        ))}
      </div>

      {/* Leaderboard toggle */}
      <button
        onClick={() => setShowLeaderboard((s) => !s)}
        style={{
          width: "100%",
          background: showLeaderboard ? "#f39c12" : "#1a1a2e",
          color: showLeaderboard ? "#111" : "#f39c12",
          border: "1px solid #f39c12",
          borderRadius: 12,
          padding: 12,
          fontWeight: "bold",
          fontSize: 13,
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        🏆 {showLeaderboard ? "Hide" : "Show"} Leaderboard
      </button>

      {showLeaderboard && (
        <div
          style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a40",
            borderRadius: 14,
            padding: 14,
          }}
        >
          {!leaderboard ? (
            <div
              style={{ color: "#888", textAlign: "center", padding: 20 }}
            >
              Loading...
            </div>
          ) : (
            <>
              <div
                style={{
                  color: "#f39c12",
                  fontWeight: "bold",
                  fontSize: 13,
                  marginBottom: 10,
                }}
              >
                💰 Top Winners
              </div>
              {(leaderboard.byWinnings || []).slice(0, 10).map((u, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 6px",
                    borderBottom: "1px solid #2a2a40",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "#fff" }}>
                    {i === 0
                      ? "🥇"
                      : i === 1
                      ? "🥈"
                      : i === 2
                      ? "🥉"
                      : `${i + 1}.`}{" "}
                    {u.firstName || u.username || "Player"}
                  </span>
                  <span style={{ color: "#2ecc71", fontWeight: "bold" }}>
                    {u.totalWinnings} ETB
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {isAdmin && (
        <div
          style={{
            marginTop: 12,
            textAlign: "center",
            color: "#f39c12",
            fontSize: 11,
          }}
        >
          👑 Admin access enabled
        </div>
      )}
    </div>
  );
}