import { useState, useEffect } from "react";
import Wallet from "./Wallet.jsx";
import LiveGame from "./Livegame.jsx";
import CartelaSelection from "./Cartelaselection.jsx";
import AdminPanel from "./Adminpanel.jsx";
import {
  disconnectSocket,
  loginWithTelegram,
  createRoom,
  getMe,
  getReferralInfo,
  getGameHistory,
  getAchievements,
  getNotifications,
  markNotificationsRead,
  useTelegram,
} from "./api";

const DEFAULT_ADMIN_IDS = ["494653076"];
const ENV_ADMIN_IDS = (process.env.REACT_APP_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ADMIN_IDS =
  ENV_ADMIN_IDS.length > 0 ? ENV_ADMIN_IDS : DEFAULT_ADMIN_IDS;

const LOGIN_TIMEOUT_MS = 10000;
const STAKES = [{ fee: 10 }, { fee: 20 }];
const WEEKLY_GAMES = [
  { fee: 50, schedule: "ቅዳሜ ማታ 12:00" },
  { fee: 100, schedule: "ቅዳሜ ማታ 12:05" },
];
const SHARED_ROOMS = { 10: "ROOM10", 20: "ROOM20", 50: "ROOM50", 100: "ROOM100" };

// ═══════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════
function Login({ onLoggedIn }) {
  const { initData, ready, telegramUser } = useTelegram();

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    if (!initData) {
      const isDev = process.env.NODE_ENV === "development";
      if (!isDev) {
        onLoggedIn(null);
        return;
      }
      onLoggedIn({
        id: "local_dev_user",
        telegramId: telegramUser?.id ? String(telegramUser.id) : "000000000",
        firstName: telegramUser?.first_name || "Dev",
        username: telegramUser?.username || "dev_user",
        balance: 1000,
        bonusBalance: 200,
        gamesWon: 0,
        referralCount: 0,
        isAdmin: false,
      });
      return;
    }

    async function handleLogin() {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Login timeout")), LOGIN_TIMEOUT_MS)
        );
        const user = await Promise.race([
          loginWithTelegram(initData),
          timeoutPromise,
        ]);
        if (cancelled) return;
        localStorage.setItem("telegramId", user.telegramId);
        onLoggedIn(user);
      } catch (err) {
        if (cancelled) return;
        if (telegramUser?.id) {
          onLoggedIn({
            id: String(telegramUser.id),
            telegramId: String(telegramUser.id),
            firstName: telegramUser.first_name || "Player",
            username: telegramUser.username || `user_${telegramUser.id}`,
            balance: 0,
            gamesWon: 0,
            isAdmin: false,
          });
        } else onLoggedIn(null);
      }
    }
    handleLogin();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initData, onLoggedIn]);

  return null;
}

// ═══════════════════════════════════════════════════════
// GAMELOBBY
// ═══════════════════════════════════════════════════════
function GameLobby({ onPlayStake }) {
  const [error, setError] = useState("");

  // 👈 ወዲያውኑ ወደ ካርቴላ — background ላይ createRoom ይላካል
  function play(fee) {
    setError("");
    // Fire and forget — ሳንጠብቅ ወደ ካርቴላ እንሂድ
    createRoom(fee, SHARED_ROOMS[fee]).catch(() => {});
    onPlayStake(fee, SHARED_ROOMS[fee]);
  }

  const StakeButton = ({ fee, schedule }) => {
    const color =
      fee === 10
        ? "#10b981"
        : fee === 20
        ? "#3b82f6"
        : fee === 50
        ? "#8b5cf6"
        : "#f59e0b";

    return (
      <div style={{ marginBottom: 10 }}>
        <button
          onClick={() => play(fee)}
          style={{
            width: "100%",
            background: `linear-gradient(135deg, ${color} 0%, ${color}cc 50%, ${color}99 100%)`,
            color: "#fff",
            border: "none",
            borderRadius: 14,
            padding: "18px 20px",
            cursor: "pointer",
            boxShadow: `0 6px 20px ${color}55`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.2s ease",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: "-100%",
              width: "100%",
              height: "100%",
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
              animation: "shine 3s infinite",
              pointerEvents: "none",
            }}
          />
          {/* 👈 ሴንተር የተደረገ ጽሑፍ */}
          <div
            style={{
              fontSize: 17,
              fontWeight: "900",
              letterSpacing: 0.5,
              zIndex: 1,
            }}
          >
            Play {fee} ETB
          </div>
        </button>
        {schedule && (
          <div
            style={{
              color: "#f39c12",
              fontSize: 11,
              textAlign: "center",
              fontWeight: "bold",
              marginTop: 5,
            }}
          >
            🗓 {schedule}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        padding: 15,
        maxWidth: 450,
        margin: "0 auto",
        paddingBottom: 100,
        paddingTop: 30,
      }}
    >
      {error && (
        <div
          style={{
            background: "linear-gradient(135deg, #e74c3c, #c0392b)",
            color: "#fff",
            padding: 12,
            borderRadius: 12,
            marginBottom: 15,
            fontSize: 13,
            textAlign: "center",
            fontWeight: "bold",
          }}
        >
          {error}
        </div>
      )}

      {/* 👈 Header ተሰርዟል — ከ app-header ጋር አንድ አይነት ነበር */}

      {/* CHOOSE STAKE */}
      <div
        style={{
          color: "#f39c12",
          fontSize: 13,
          fontWeight: "bold",
          letterSpacing: 2,
          marginBottom: 14,
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            height: 1,
            width: 30,
            background: "linear-gradient(90deg, transparent, #f39c12)",
          }}
        />
        🎯 CHOOSE STAKE
        <span
          style={{
            height: 1,
            width: 30,
            background: "linear-gradient(90deg, #f39c12, transparent)",
          }}
        />
      </div>

      {STAKES.map((s) => (
        <StakeButton key={s.fee} fee={s.fee} />
      ))}

      {/* WEEKLY GAME */}
      <div
        style={{
          color: "#f39c12",
          fontSize: 13,
          fontWeight: "bold",
          letterSpacing: 2,
          marginTop: 20,
          marginBottom: 14,
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            height: 1,
            width: 30,
            background: "linear-gradient(90deg, transparent, #f39c12)",
          }}
        />
        🗓 WEEKLY GAME
        <span
          style={{
            height: 1,
            width: 30,
            background: "linear-gradient(90deg, #f39c12, transparent)",
          }}
        />
      </div>

      {WEEKLY_GAMES.map((g) => (
        <StakeButton key={g.fee} fee={g.fee} schedule={g.schedule} />
      ))}

      <style>{`
        @keyframes shine {
          0% { left: -100%; }
          50%, 100% { left: 200%; }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════
const ALL_ACHIEVEMENTS = [
  { id: "first_game", label: "First Game", icon: "🎮", desc: "Play first game" },
  { id: "first_win", label: "First Win", icon: "🏆", desc: "Win first game" },
  { id: "10_games", label: "10 Games", icon: "🎯", desc: "Play 10 games" },
  { id: "10_wins", label: "10 Wins", icon: "👑", desc: "Win 10 games" },
  { id: "1000_won", label: "1K Winnings", icon: "💰", desc: "Earn 1000 ETB" },
  { id: "referrer", label: "Referrer", icon: "🔗", desc: "Invite a friend" },
];

function Profile({ user, balance, onUserUpdate }) {
  const [tab, setTab] = useState("Stats");
  const [profile, setProfile] = useState(user);
  const [referral, setReferral] = useState(null);
  const [history, setHistory] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [me, ref, hist, ach, notifs] = await Promise.all([
        getMe().catch(() => null),
        getReferralInfo().catch(() => null),
        getGameHistory(20).catch(() => []),
        getAchievements().catch(() => []),
        getNotifications(20).catch(() => ({
          notifications: [],
          unreadCount: 0,
        })),
      ]);
      if (cancelled) return;
      if (me) {
        setProfile(me);
        onUserUpdate?.(me);
      }
      if (ref) setReferral(ref);
      setHistory(hist);
      setAchievements(ach);
      setNotifications(notifs.notifications || []);
      setUnread(notifs.unreadCount || 0);
    })();
    return () => {
      cancelled = true;
    };
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
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else copyLink();
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

      {tab === "Stats" && (
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
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
          {history.length === 0 && <EmptyState text="No games yet" icon="🎮" />}
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
                <div
                  style={{ color: "#fff", fontWeight: "bold", fontSize: 13 }}
                >
                  {g.roomCode} {g.won && "🏆"}
                </div>
                <div
                  style={{
                    color: g.won ? "#2ecc71" : "#888",
                    fontSize: 12,
                    fontWeight: "bold",
                  }}
                >
                  {g.won ? `+${g.prizePool} ETB` : `-${g.entryFee} ETB`}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>
                {g.won
                  ? `Won with card #${g.cardId} (${g.pattern})`
                  : `Lost — entry ${g.entryFee} ETB`}
                <br />
                {g.finishedAt ? new Date(g.finishedAt).toLocaleString() : "—"}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === "Achievements" && (
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
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
                No invites yet
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
                <div style={{ color: "#666", fontSize: 10, marginTop: 6 }}>
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </>
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
      <div style={{ color, fontSize: 16, fontWeight: "bold", marginTop: 2 }}>
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

// ═══════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════
function App() {
  useTelegram();

  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [roomCode, setRoomCode] = useState(null);
  const [cardIds, setCardIds] = useState([]);
  const [showCartela, setShowCartela] = useState(false);
  const [stakeAmount, setStakeAmount] = useState(10);
  const [activeTab, setActiveTab] = useState("Game");
  const [showWalletHistory, setShowWalletHistory] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const isAdmin =
    user?.isAdmin === true ||
    (user?.telegramId && ADMIN_IDS.includes(String(user.telegramId)));

  const tabs = [
    { id: "Game", label: "Game", icon: "🎮" },
    { id: "Wallet", label: "Wallet", icon: "💳" },
    { id: "Profile", label: "Profile", icon: "👤" },
  ];
  if (isAdmin) tabs.push({ id: "Admin", label: "Admin", icon: "⚙️" });

  useEffect(() => {
    if (!user) return;
    const load = () => {
      getNotifications(1)
        .then((d) => setUnreadCount(d.unreadCount || 0))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [user]);

  if (!user) {
    return (
      <Login
        onLoggedIn={(u) => {
          setUser(u);
          setBalance(u.balance);
        }}
      />
    );
  }

  const handlePlayStake = (fee, code) => {
    setStakeAmount(fee);
    setRoomCode(code);
    setShowCartela(true);
  };

  const handleCartelaConfirm = (ids) => {
    setCardIds(ids);
    setShowCartela(false);
  };

  const handleLeave = () => {
    disconnectSocket();
    setRoomCode(null);
    setCardIds([]);
    setShowCartela(false);
    setStakeAmount(10);
    setActiveTab("Game");
  };

  const handleGameEnded = () => {
    disconnectSocket();
    setCardIds([]);
    setShowCartela(true);
  };

  return (
    <div className="app" style={{ paddingBottom: 80 }}>
      {/* 👈 app-header ሙሉ በሙሉ ተሰርዟል */}

      {activeTab === "Game" && (
        <>
          {showCartela ? (
            <CartelaSelection
              roomCode={roomCode}
              balance={balance}
              stake={stakeAmount}
              onConfirm={handleCartelaConfirm}
              onCancel={handleLeave}
            />
          ) : roomCode ? (
            <LiveGame
              roomCode={roomCode}
              cardIds={cardIds}
              setBalance={setBalance}
              telegramId={user.telegramId}
              onExit={handleLeave}
              onGameEnded={handleGameEnded}
            />
          ) : (
            <GameLobby onPlayStake={handlePlayStake} />
          )}
        </>
      )}

      {activeTab === "Wallet" && (
        <>
          <div
            style={{
              padding: "10px 15px",
              maxWidth: "450px",
              margin: "0 auto",
              display: "flex",
              gap: 8,
            }}
          >
            <button
              onClick={() => setShowWalletHistory(false)}
              style={{
                flex: 1,
                background: !showWalletHistory ? "#f39c12" : "#1a1a2e",
                color: !showWalletHistory ? "#111" : "#fff",
                border: "1px solid #f39c12",
                borderRadius: 10,
                padding: "10px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              💳 Wallet
            </button>
            <button
              onClick={() => setShowWalletHistory(true)}
              style={{
                flex: 1,
                background: showWalletHistory ? "#f39c12" : "#1a1a2e",
                color: showWalletHistory ? "#111" : "#fff",
                border: "1px solid #f39c12",
                borderRadius: 10,
                padding: "10px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              📜 History
            </button>
          </div>
          <Wallet
            balance={balance}
            setBalance={setBalance}
            showHistory={showWalletHistory}
          />
        </>
      )}

      {activeTab === "Profile" && (
        <Profile
          user={user}
          balance={balance}
          onUserUpdate={(u) => setUser((prev) => ({ ...prev, ...u }))}
        />
      )}

      {activeTab === "Admin" && <AdminPanel />}

      {!showCartela && !roomCode && (
        <nav className="bottom-nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={activeTab === t.id ? "nav-item active" : "nav-item"}
              onClick={() => setActiveTab(t.id)}
              style={{ position: "relative" }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {t.id === "Profile" && unreadCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    right: "25%",
                    background: "#e74c3c",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 16,
                    height: 16,
                    fontSize: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                  }}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

export default App;