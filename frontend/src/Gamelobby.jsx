import React, { useEffect, useState, useCallback } from "react";
import { createRoom, getGameStats } from "./api";

const STAKES = [
  { fee: 10, color: "#2ecc71" },
  { fee: 20, color: "#3498db" },
];

const WEEKLY_GAMES = [
  { fee: 50, color: "#3498db", schedule: "weekly (ቅዳሜ ማታ 12:00)" },
  { fee: 100, color: "#2ecc71", schedule: "weekly (ቅዳሜ ማታ 12:05)" },
];

export default function GameLobby({ onPlayStake, isAdmin, adminStats }) {
  const [stats, setStats] = useState({ totalUsers: 0, totalGames: 0 });
  const [quickPlayFee, setQuickPlayFee] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  // ስታቲስቲክስን በየ15 ሰከንዱ ማደስ
  const loadData = useCallback(async () => {
    try {
      const statsData = await getGameStats().catch(() => ({ totalUsers: 0, totalGames: 0 }));
      setStats(statsData || { totalUsers: 0, totalGames: 0 });
    } catch (err) {
      console.warn("Failed to load lobby data:", err.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await loadData();
    })();

    const interval = setInterval(() => {
      if (!cancelled) loadData();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadData]);

     async function handleQuickPlay(fee) {
    setErrorMessage("");
    setQuickPlayFee(fee);
    try {
      // 👈 ቋሚ የክፍል ኮድ — ሁሉም ተጠቃሚዎች ወደዚሁ ይገባሉ
      const SHARED_ROOMS = {
        10: "ROOM10",
        20: "ROOM20",
        50: "ROOM50",
        100: "ROOM100",
      };
      const roomCode = SHARED_ROOMS[fee] || `ROOM${fee}`;
      const room = await createRoom(fee, roomCode);
      onPlayStake(fee, room.roomCode);
    } catch (err) {
      setErrorMessage("Could not start the game. Please try again.");
    } finally {
      setQuickPlayFee(null);
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

  // የ Admin ስታቲስቲክስ ካለ እሱን፣ ካለበለዚያ የጨዋታ ስታቲስቲክስን ተጠቀም
  const displayActiveUsers = adminStats?.activeUsers ?? 0;
  const displayRegisteredUsers =
    adminStats?.registeredUsers ?? stats.totalUsers ?? 0;

  return (
    <div
      className="lobby"
      style={{ padding: "15px", maxWidth: "450px", margin: "0 auto" }}
    >
      {errorMessage && (
        <div
          style={{
            background: "#e74c3c",
            color: "#fff",
            padding: "10px",
            borderRadius: "8px",
            marginBottom: "15px",
            fontSize: "13px",
            textAlign: "center",
          }}
        >
          {errorMessage}
        </div>
      )}

      <h2 style={{ color: "#fff", textAlign: "center", marginBottom: "20px" }}>
        Welcome to <span style={{ color: "#f39c12" }}>Fetan Bingo</span>
      </h2>

      {/* ---- Choose Stake ---- */}
      <div
        style={{
          border: "1px solid #f39c12",
          borderRadius: "14px",
          padding: "16px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            color: "#f39c12",
            fontWeight: "bold",
            textAlign: "center",
            marginBottom: "12px",
          }}
        >
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
      <div
        style={{
          border: "1px solid #f39c12",
          borderRadius: "14px",
          padding: "16px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            color: "#f39c12",
            fontWeight: "bold",
            textAlign: "center",
            marginBottom: "12px",
          }}
        >
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
            <div
              style={{
                color: "#f39c12",
                fontSize: "12px",
                textAlign: "center",
              }}
            >
              {g.schedule}
            </div>
          </div>
        ))}
      </div>

      {/* ---- ስታቲስቲክስ (ለአድሚን ብቻ የሚታይ) ---- */}
      {isAdmin && (
        <div
          style={{
            background: "#12121e",
            border: "1px solid #2a2a40",
            borderRadius: "14px",
            padding: "16px",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-around",
              textAlign: "center",
            }}
          >
            <div>
              <div
                style={{ color: "#fff", fontSize: "22px", fontWeight: "bold" }}
              >
                {displayActiveUsers}
              </div>
              <div style={{ color: "#aaa", fontSize: "11px" }}>Active Users</div>
            </div>
            <div>
              <div
                style={{ color: "#fff", fontSize: "22px", fontWeight: "bold" }}
              >
                {displayRegisteredUsers}
              </div>
              <div style={{ color: "#aaa", fontSize: "11px" }}>
                Registered Users
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}