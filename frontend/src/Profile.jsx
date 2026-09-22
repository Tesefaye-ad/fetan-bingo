import { useState, useEffect } from "react";
import {
  getMe,
  getReferralInfo,
  getGameHistory,
  getAchievements,
  getNotifications,
  markNotificationsRead,
} from "./api";

const ALL_ACHIEVEMENTS = [
  { id: "first_game", label: "First Game", icon: "🎮", desc: "Play your first game" },
  { id: "first_win", label: "First Win", icon: "🏆", desc: "Win your first game" },
  { id: "10_games", label: "10 Games", icon: "🎯", desc: "Play 10 games" },
  { id: "10_wins", label: "10 Wins", icon: "👑", desc: "Win 10 games" },
  { id: "1000_won", label: "1K Winnings", icon: "💰", desc: "Earn 1000 ETB total" },
  { id: "referrer", label: "Referrer", icon: "🔗", desc: "Invite a friend" },
];

export default function Profile({ user, balance, onUserUpdate }) {
  const [tab, setTab] = useState("Stats");
  const [profile, setProfile] = useState(user);
  const [referral, setReferral] = useState(null);
  const [history, setHistory] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [me, ref, hist, ach, notifs] = await Promise.all([
        getMe().catch(() => null),
        getReferralInfo().catch(() => null),
        getGameHistory(20).catch(() => []),
        getAchievements().catch(() => []),
        getNotifications(20).catch(() => ({ notifications: [], unreadCount: 0 })),
      ]);
      if (me) {
        setProfile(me);
        onUserUpdate?.(me);
      }
      if (ref) setReferral(ref);
      setHistory(hist);
      setAchievements(ach);
      setNotifications(notifs.notifications || []);
      setUnread(notifs.unreadCount || 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "Notifications" && unread > 0) {
      markNotificationsRead()
        .then(() => setUnread(0))
        .catch(() => {});
    }
  }, [tab, unread]);

  const copyLink = async () => {
    if (!referral?.link) return;
    try {
      await navigator.clipboard.writeText(referral.link);
      alert("✅ Link copied!");
    } catch {
      alert(referral.link);
    }
  };

  const shareLink = () => {
    if (!referral?.link) return;
    const text = `🎱 Join Fetan Bingo and start winning!\n${referral.link}`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      copyLink();
    }
  };

  const initial = (profile?.firstName || profile?.username || "U")
    .charAt(0)
    .toUpperCase();

  return (
    <div
      style={{
        padding: 15,
        maxWidth: 480,
        margin: "0 auto",
        color: "#fff",
        paddingBottom: 100,
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#3498db,#2980b9)",
            color: "#fff",
            fontSize: 36,
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 10px",
            border: "2px solid #f39c12",
          }}
        >
          {initial}
        </div>
        <h2 style={{ margin: "5px 0", color: "#fff" }}>
          {profile?.firstName || "User"} {profile?.lastName || ""}
        </h2>
        <p style={{ color: "#f39c12", margin: 0 }}>
          {profile?.username
            ? `@${profile.username}`
            : `@id_${profile?.telegramId}`}
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 15,
          overflowX: "auto",
        }}
      >
        {["Stats", "History", "Achievements", "Invite", "Notifications"].map(
          (t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                minWidth: 75,
                background: tab === t ? "#f39c12" : "#1a1a2e",
                color: tab === t ? "#111" : "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 4px",
                fontSize: 11,
                fontWeight: "bold",
                cursor: "pointer",
                position: "relative",
              }}
            >
              {t}
              {t === "Notifications" && unread > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    background: "#e74c3c",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 18,
                    height: 18,
                    fontSize: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                  }}
                >
                  {unread}
                </span>
              )}
            </button>
          )
        )}
      </div>

      {/* Tab Content */}
      {tab === "Stats" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Card
            icon="💳"
            label="Balance"
            value={`${balance} ETB`}
            color="#2ecc71"
          />
          <Card
            icon="🏆"
            label="Wins"
            value={profile?.gamesWon || 0}
            color="#f39c12"
          />
          <Card
            icon="🎮"
            label="Games"
            value={profile?.gamesPlayed || 0}
            color="#3498db"
          />
          <Card
            icon="💰"
            label="Total Won"
            value={`${profile?.totalWinnings || 0} ETB`}
            color="#e67e22"
          />
          <Card
            icon="📥"
            label="Deposits"
            value={`${profile?.totalDeposits || 0} ETB`}
            color="#16a085"
          />
          <Card
            icon="📤"
            label="Withdrawals"
            value={`${profile?.totalWithdrawals || 0} ETB`}
            color="#c0392b"
          />
        </div>
      )}

      {tab === "History" && (
        <>
          {history.length === 0 && (
            <EmptyState text="No games played yet" icon="🎮" />
          )}
          {history.map((g, i) => (
            <div
              key={i}
              style={{
                background: "#1a1a2e",
                border: `1px solid ${g.won ? "#2ecc71" : "#2a2a40"}`,
                borderRadius: 10,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <div style={{ color: "#fff", fontWeight: "bold", fontSize: 13 }}>
                  {g.roomCode} {g.won && "🏆"}
                </div>
                <div
                  style={{
                    color: g.won ? "#2ecc71" : "#888",
                    fontSize: 12,
                    fontWeight: "bold",
                  }}
                >
                  {g.won ? `+${Math.floor(g.prizePool / 1)} ETB` : `-${g.entryFee} ETB`}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>
                {g.won
                  ? `Won with card #${g.cardId} (${g.pattern})`
                  : `Lost — entry ${g.entryFee} ETB`}
                <br />
                {g.finishedAt
                  ? new Date(g.finishedAt).toLocaleString()
                  : "—"}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === "Achievements" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          {ALL_ACHIEVEMENTS.map((a) => {
            const unlocked = achievements.includes(a.id);
            return (
              <div
                key={a.id}
                style={{
                  background: unlocked
                    ? "linear-gradient(135deg,#f39c12,#e67e22)"
                    : "#1a1a2e",
                  border: `1px solid ${unlocked ? "#ffd43b" : "#2a2a40"}`,
                  borderRadius: 12,
                  padding: 12,
                  textAlign: "center",
                  opacity: unlocked ? 1 : 0.5,
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 4 }}>{a.icon}</div>
                <div
                  style={{
                    color: unlocked ? "#111" : "#fff",
                    fontWeight: "bold",
                    fontSize: 12,
                  }}
                >
                  {a.label}
                </div>
                <div
                  style={{
                    color: unlocked ? "#111" : "#888",
                    fontSize: 10,
                    marginTop: 2,
                  }}
                >
                  {a.desc}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "Invite" && (
        <>
          <div
            style={{
              background: "linear-gradient(135deg,#1a1a2e,#0f1420)",
              border: "2px solid #f39c12",
              borderRadius: 14,
              padding: 16,
              marginBottom: 12,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 40 }}>🎁</div>
            <div
              style={{
                color: "#f39c12",
                fontSize: 16,
                fontWeight: "bold",
                marginBottom: 8,
              }}
            >
              Invite & Earn 5 ETB
            </div>
            <div
              style={{
                color: "#aaa",
                fontSize: 12,
                marginBottom: 15,
                lineHeight: 1.5,
              }}
            >
              Share your link with friends. You get 5 ETB for each friend who
              joins!
            </div>
            <div
              style={{
                background: "#0f1420",
                border: "1px solid #2a2a40",
                borderRadius: 8,
                padding: 10,
                fontSize: 11,
                color: "#2ecc71",
                wordBreak: "break-all",
                marginBottom: 12,
                fontFamily: "monospace",
              }}
            >
              {referral?.link || "Loading..."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={copyLink}
                style={{
                  flex: 1,
                  background: "#3498db",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: 12,
                  fontWeight: "bold",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                📋 Copy
              </button>
              <button
                onClick={shareLink}
                style={{
                  flex: 1,
                  background: "linear-gradient(135deg,#f39c12,#e67e22)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: 12,
                  fontWeight: "bold",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                📤 Share
              </button>
            </div>
          </div>

          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a40",
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div
              style={{
                color: "#f39c12",
                fontWeight: "bold",
                fontSize: 13,
                marginBottom: 10,
              }}
            >
              👥 Invited Friends ({referral?.referralCount || 0})
            </div>
            {referral?.invited?.length > 0 ? (
              referral.invited.map((u, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: "1px solid #2a2a40",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "#fff" }}>👤 {u.name}</span>
                  <span style={{ color: "#888" }}>
                    {new Date(u.joinedAt).toLocaleDateString()}
                  </span>
                </div>
              ))
            ) : (
              <div
                style={{
                  textAlign: "center",
                  color: "#888",
                  fontSize: 12,
                  padding: 10,
                }}
              >
                No invites yet — share your link!
              </div>
            )}
          </div>
        </>
      )}

      {tab === "Notifications" && (
        <>
          {notifications.length === 0 ? (
            <EmptyState text="No notifications" icon="🔔" />
          ) : (
            notifications.map((n) => (
              <div
                key={n._id}
                style={{
                  background: "#1a1a2e",
                  border: `1px solid ${
                    n.type === "success" || n.type === "prize"
                      ? "#2ecc71"
                      : n.type === "warning"
                      ? "#e74c3c"
                      : "#2a2a40"
                  }`,
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: 13,
                    marginBottom: 4,
                  }}
                >
                  {n.title}
                </div>
                <div style={{ color: "#aaa", fontSize: 12, lineHeight: 1.5 }}>
                  {n.body}
                </div>
                <div
                  style={{
                    color: "#666",
                    fontSize: 10,
                    marginTop: 6,
                  }}
                >
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {loading && (
        <div
          style={{
            textAlign: "center",
            color: "#888",
            padding: 20,
            fontSize: 12,
          }}
        >
          Loading...
        </div>
      )}
    </div>
  );
}

function Card({ icon, label, value, color }) {
  return (
    <div
      style={{
        background: "#1a1a2e",
        border: `1px solid ${color}40`,
        borderRadius: 12,
        padding: 14,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 24 }}>{icon}</div>
      <div style={{ color: "#aaa", fontSize: 11, marginTop: 4 }}>{label}</div>
      <div
        style={{
          color,
          fontSize: 16,
          fontWeight: "bold",
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({ text, icon }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: 40,
        color: "#888",
        border: "1px dashed #2a2a40",
        borderRadius: 12,
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      {text}
    </div>
  );
}