import { useState, useEffect, useCallback, useMemo } from "react";
import Wallet from "./Wallet.jsx";
import LiveGame from "./Livegame.jsx";
import CartelaSelection from "./Cartelaselection.jsx";
import AdminPanel from "./Adminpanel.jsx";
import {
  loginWithTelegram,
  getRoom,
  getMe,
  getReferralInfo,
  getGameHistory,
  getWalletHistory,
  useTelegram,
  warmUpServer,
} from "./api";

// ✅ FIX: Hardcoded admin IDs ተወግዷል — backend ብቻ ይወስናል
const LOGIN_TIMEOUT_MS = 30000;

const SHARED_ROOMS = {
  10: "ROOM10",
  20: "ROOM20",
  50: "ROOM50",
  100: "ROOM100",
};

// ═══════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════
function Login({ onLoggedIn }) {
  const { initData, ready, telegramUser } = useTelegram();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setError("");
    setLoading(true);

    if (!initData) {
      if (process.env.NODE_ENV === "development") {
        onLoggedIn({
          id: "local_dev_user",
          telegramId: telegramUser?.id ? String(telegramUser.id) : "000000000",
          firstName: telegramUser?.first_name || "Dev",
          username: telegramUser?.username || "dev_user",
          balance: 1000,
          bonusBalance: 200,
          gamesWon: 0,
          referralCount: 0,
          isAdmin: true,
        });
      } else {
        setError(
          "ይህን ጨዋታ ከ Telegram ቦት ውስጥ ባለው «Play 🎮» ቁልፍ ብቻ ይክፈቱ።"
        );
        setLoading(false);
      }
      return;
    }

    async function handleLogin() {
      await warmUpServer();
      let lastErr = null;

      for (let i = 1; i <= 3; i++) {
        if (cancelled) return;
        let timerId = null;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            timerId = setTimeout(
              () => reject(new Error("Login timeout")),
              LOGIN_TIMEOUT_MS
            );
          });
          const user = await Promise.race([
            loginWithTelegram(initData),
            timeoutPromise,
          ]);
          if (timerId) clearTimeout(timerId);
          if (cancelled) return;
          localStorage.setItem("telegramId", user.telegramId);
          onLoggedIn(user);
          return;
        } catch (err) {
          if (timerId) clearTimeout(timerId);
          lastErr = err;
          console.warn("[Login] attempt", i, "failed:", err?.message);
          const code = err?.response?.status;
          if (code === 401 || code === 403) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (cancelled) return;
      setLoading(false);
      const code = lastErr?.response?.status;
      if (code === 403) setError("አካውንትዎ ታግዷል። ድጋፍ ያግኙ።");
      else if (code === 401)
        setError(
          "የ Telegram ማረጋገጫ አልተሳካም። ቦቱን ዘግተው በ «Play 🎮» ቁልፍ እንደገና ይክፈቱ።"
        );
      else
        setError(
          "ከሰርቨር ጋር መገናኘት አልተቻለም። ኢንተርኔትዎን ያረጋግጡ እና እንደገና ይሞክሩ።"
        );
    }
    handleLogin();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initData, telegramUser?.id, attempt]);

  if (loading && !error) {
    return <GameLobby onPlayStake={() => {}} isLoading={true} />;
  }

  if (!error) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center",
        color: "#fff",
        background:
          "linear-gradient(180deg, #0a0a14 0%, #150a2e 50%, #0a0a14 100%)",
      }}
    >
      <div style={{ fontSize: 48 }}>🎰</div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 900,
          background:
            "linear-gradient(135deg, #f39c12 0%, #ffd43b 50%, #f39c12 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        Fetan Bingo
      </div>
      <div
        style={{
          maxWidth: 320,
          lineHeight: 1.5,
          opacity: 0.9,
          fontSize: 13,
        }}
      >
        {error}
      </div>
      {initData && (
        <button
          onClick={() => {
            setAttempt((n) => n + 1);
            setError("");
            setLoading(true);
          }}
          style={{
            background: "linear-gradient(135deg,#27ae60,#1e8449)",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            padding: "12px 28px",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 6px 20px rgba(39,174,96,0.4)",
          }}
        >
          🔄 እንደገና ሞክር
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// GAME LOBBY
// ═══════════════════════════════════════════════════════
function GameButton({ fee, color1, color2, glowColor, onPlay, isLoading }) {
  return (
    <button
      onClick={() => !isLoading && onPlay(fee)}
      disabled={isLoading}
      style={{
        width: "100%",
        background: `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`,
        color: "#fff",
        border: "none",
        borderRadius: 14,
        padding: "18px 24px",
        cursor: isLoading ? "not-allowed" : "pointer",
        boxShadow: `0 8px 24px ${glowColor}66, 0 4px 12px ${glowColor}44, inset 0 1px 0 rgba(255,255,255,0.2)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.1s ease, opacity 0.2s ease",
        fontFamily: "inherit",
        opacity: isLoading ? 0.6 : 1,
      }}
      onMouseDown={(e) => {
        if (!isLoading) e.currentTarget.style.transform = "scale(0.98)";
      }}
      onMouseUp={(e) => {
        if (!isLoading) e.currentTarget.style.transform = "scale(1)";
      }}
      onTouchStart={(e) => {
        if (!isLoading) e.currentTarget.style.transform = "scale(0.98)";
      }}
      onTouchEnd={(e) => {
        if (!isLoading) e.currentTarget.style.transform = "scale(1)";
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
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
          animation: isLoading ? "none" : "shine 3s infinite",
          pointerEvents: "none",
        }}
      />
      <span
        style={{
          fontSize: 14,
          opacity: 0.95,
          textShadow: "0 1px 2px rgba(0,0,0,0.3)",
          zIndex: 1,
        }}
      >
        ▶
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: "900",
          letterSpacing: 0.3,
          textShadow: "0 2px 4px rgba(0,0,0,0.3)",
          zIndex: 1,
        }}
      >
        Play {fee} ETB
      </span>
    </button>
  );
}

function GameLobby({ onPlayStake, isLoading }) {
  function play(fee) {
    onPlayStake(fee, SHARED_ROOMS[fee] || `ROOM${fee}`);
  }

  return (
    <div
      style={{
        padding: "20px 15px",
        maxWidth: 450,
        margin: "0 auto",
        paddingBottom: 100,
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0f1420 0%, #1a0f2e 100%)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 20, marginTop: 10 }}>
        <h1
          style={{
            color: "#fff",
            fontSize: 34,
            fontWeight: "900",
            margin: 0,
            lineHeight: 1.15,
            letterSpacing: 0.5,
            textShadow: "0 2px 10px rgba(0,0,0,0.3)",
          }}
        >
          Welcome to{" "}
          <span
            style={{
              background:
                "linear-gradient(135deg, #f39c12 0%, #ffd43b 50%, #f39c12 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              filter: "drop-shadow(0 2px 8px rgba(243,156,18,0.5))",
            }}
          >
            Fetan Bingo
          </span>
        </h1>
      </div>

      <div
        style={{
          background:
            "linear-gradient(135deg, rgba(26,26,46,0.7) 0%, rgba(15,20,32,0.9) 100%)",
          border: "1px solid rgba(46,204,113,0.3)",
          borderRadius: 20,
          padding: "20px 16px 18px",
          marginBottom: 16,
          boxShadow:
            "0 4px 20px rgba(46,204,113,0.1), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div
          style={{
            textAlign: "center",
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 16, color: "#2ecc71" }}>⚡</span>
          <span
            style={{
              color: "#2ecc71",
              fontSize: 14,
              fontWeight: "900",
              letterSpacing: 3,
              textShadow: "0 0 12px rgba(46,204,113,0.5)",
            }}
          >
            INSTANT BINGO
          </span>
          <span style={{ fontSize: 16, color: "#2ecc71" }}>⚡</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <GameButton
            onPlay={play}
            fee={10}
            color1="#10b981"
            color2="#059669"
            glowColor="#10b981"
            isLoading={isLoading}
          />
          <GameButton
            onPlay={play}
            fee={20}
            color1="#06b6d4"
            color2="#0891b2"
            glowColor="#06b6d4"
            isLoading={isLoading}
          />
        </div>
      </div>

      <div
        style={{
          background:
            "linear-gradient(135deg, rgba(26,26,46,0.7) 0%, rgba(15,20,32,0.9) 100%)",
          border: "1px solid rgba(243,156,18,0.3)",
          borderRadius: 20,
          padding: "20px 16px 18px",
          marginBottom: 16,
          boxShadow:
            "0 4px 20px rgba(243,156,18,0.1), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div
          style={{
            textAlign: "center",
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 16 }}>🏆</span>
          <span
            style={{
              color: "#f39c12",
              fontSize: 14,
              fontWeight: "900",
              letterSpacing: 3,
              textShadow: "0 0 12px rgba(243,156,18,0.5)",
            }}
          >
            DAILY BINGO
          </span>
          <span style={{ fontSize: 16 }}>🏆</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <GameButton
            onPlay={play}
            fee={50}
            color1="#8b5cf6"
            color2="#7c3aed"
            glowColor="#8b5cf6"
            isLoading={isLoading}
          />
          <GameButton
            onPlay={play}
            fee={100}
            color1="#f59e0b"
            color2="#d97706"
            glowColor="#f59e0b"
            isLoading={isLoading}
          />
        </div>
      </div>

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
// HISTORY PAGE
// ✅ FIX: Entry Fee ተጣርቷል (የብር ገቢ እና ወጪ ብቻ ያሳያል)
// ═══════════════════════════════════════════════════════
function HistoryPage() {
  const [tab, setTab] = useState("transactions");
  const [transactions, setTransactions] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [txs, gms] = await Promise.all([
        getWalletHistory().catch(() => []),
        getGameHistory(50).catch(() => []),
      ]);
      if (cancelled) return;

      // ✅ FIX: የጨዋታ መግቢያ (entry_fee) ግብይቶችን ማጣራት
      const filteredTxs = (txs || []).filter((tx) => tx.type !== "entry_fee");

      setTransactions(filteredTxs);
      setGames(gms || []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const typeIcon = {
    deposit: "📥",
    withdrawal: "📤",
    prize: "🏆",
    refund: "↩️",
    transfer_in: "📩",
    transfer_out: "📨",
  };

  const isOut = (tx) =>
    ["withdrawal", "transfer_out"].includes(tx.type);

  return (
    <div
      style={{
        padding: 15,
        maxWidth: 480,
        margin: "0 auto",
        color: "#fff",
        paddingBottom: 100,
        background: "linear-gradient(180deg, #0a0a14 0%, #150a2e 100%)",
        minHeight: "100vh",
      }}
    >
      <h2
        style={{
          color: "#f39c12",
          margin: "0 0 16px",
          fontSize: 22,
          fontWeight: "900",
          letterSpacing: 1,
          textAlign: "center",
          background: "linear-gradient(135deg, #f39c12, #ffd43b, #f39c12)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        📜 HISTORY
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <button
          onClick={() => setTab("transactions")}
          style={{
            background: tab === "transactions" ? "#f39c12" : "#1a1a2e",
            color: tab === "transactions" ? "#111" : "#fff",
            border: `1px solid ${
              tab === "transactions" ? "#f39c12" : "#2a2a40"
            }`,
            borderRadius: 10,
            padding: "10px",
            fontSize: 13,
            fontWeight: "bold",
            cursor: "pointer",
            boxShadow:
              tab === "transactions"
                ? "0 0 15px rgba(243,156,18,0.4)"
                : "none",
          }}
        >
          💰 Transactions ({transactions.length})
        </button>
        <button
          onClick={() => setTab("games")}
          style={{
            background: tab === "games" ? "#3498db" : "#1a1a2e",
            color: "#fff",
            border: `1px solid ${tab === "games" ? "#3498db" : "#2a2a40"}`,
            borderRadius: 10,
            padding: "10px",
            fontSize: 13,
            fontWeight: "bold",
            cursor: "pointer",
            boxShadow:
              tab === "games" ? "0 0 15px rgba(52,152,219,0.4)" : "none",
          }}
        >
          🎮 Games ({games.length})
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: "center", color: "#888", padding: 40 }}>
          Loading...
        </div>
      )}

      {!loading && tab === "transactions" && (
        <>
          {transactions.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                color: "#666",
                border: "1px dashed #2a2a40",
                borderRadius: 12,
                fontSize: 13,
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 10, opacity: 0.5 }}>
                📭
              </div>
              <div style={{ fontWeight: "700" }}>No transactions yet</div>
            </div>
          ) : (
            transactions.map((tx) => {
              const out = isOut(tx);
              return (
                <div
                  key={tx._id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background:
                      "linear-gradient(135deg, rgba(26,26,46,0.9), rgba(15,20,32,0.9))",
                    border: `1px solid ${
                      tx.status === "completed"
                        ? out
                          ? "rgba(231,76,60,0.3)"
                          : "rgba(46,204,113,0.3)"
                        : tx.status === "pending"
                        ? "rgba(243,156,18,0.4)"
                        : "rgba(42,42,64,0.6)"
                    }`,
                    borderRadius: 12,
                    padding: "12px 14px",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: out
                          ? "rgba(231,76,60,0.15)"
                          : "rgba(46,204,113,0.15)",
                        border: `1px solid ${
                          out
                            ? "rgba(231,76,60,0.4)"
                            : "rgba(46,204,113,0.4)"
                        }`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                      }}
                    >
                      {typeIcon[tx.type] || "💰"}
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: "700",
                          textTransform: "capitalize",
                          fontSize: 12,
                          marginBottom: 2,
                        }}
                      >
                        {tx.type.replace("_", " ")}
                      </div>
                      <div style={{ color: "#666", fontSize: 10 }}>
                        {new Date(tx.createdAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        color: out ? "#e74c3c" : "#2ecc71",
                        fontWeight: "900",
                        fontSize: 14,
                      }}
                    >
                      {out ? "-" : "+"}
                      {tx.amount} ETB
                    </div>
                    <div
                      style={{
                        color:
                          tx.status === "pending"
                            ? "#f39c12"
                            : tx.status === "failed"
                            ? "#e74c3c"
                            : "#666",
                        fontSize: 9,
                        fontWeight: "700",
                        textTransform: "uppercase",
                        marginTop: 2,
                      }}
                    >
                      {tx.status}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </>
      )}

      {!loading && tab === "games" && (
        <>
          {games.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                color: "#666",
                border: "1px dashed #2a2a40",
                borderRadius: 12,
                fontSize: 13,
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 10, opacity: 0.5 }}>
                🎮
              </div>
              <div style={{ fontWeight: "700" }}>No games yet</div>
            </div>
          ) : (
            games.map((g, i) => (
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
                    style={{
                      fontWeight: "bold",
                      fontSize: 13,
                      color: "#fff",
                    }}
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
                  {g.finishedAt
                    ? new Date(g.finishedAt).toLocaleString()
                    : "—"}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// PROFILE
// ✅ FIX: "Notifications" ታብ ሙሉ በሙሉ ተወግዷል
// ═══════════════════════════════════════════════════════
function Profile({ user, balance, onUserUpdate }) {
  const [tab, setTab] = useState("Stats");
  const [profile, setProfile] = useState(user);
  const [referral, setReferral] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [me, ref] = await Promise.all([
        getMe().catch(() => null),
        getReferralInfo().catch(() => null),
      ]);
      if (cancelled) return;
      if (me) {
        setProfile(me);
        onUserUpdate?.(me);
      }
      if (ref) setReferral(ref);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const text = `🎱 Join Fetan Bingo!\n${referral.link}`;
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
        <h2 style={{ margin: "5px 0" }}>
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
        {/* ✅ Notifications ተወግዷል፣ Stats እና Invite ብቻ ቀርተዋል */}
        {["Stats", "Invite"].map((t) => (
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
          </button>
        ))}
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
        </div>
      )}

      {tab === "Invite" && (
        <div
          style={{
            background: "linear-gradient(135deg,#1a1a2e,#0f1420)",
            border: "2px solid #f39c12",
            borderRadius: 14,
            padding: 16,
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
  const [gameStatus, setGameStatus] = useState("waiting");

  // ✅ FIX: Admin ከ backend ብቻ ይወሰናል (client hardcoded የለም)
  const isAdmin = user?.isAdmin === true;

  // ✅ FIX: tabs useMemo
  const tabs = useMemo(() => {
    const base = [
      { id: "Game", label: "Game", icon: "🎮" },
      { id: "Wallet", label: "Wallet", icon: "💳" },
      { id: "History", label: "History", icon: "📜" },
      { id: "Profile", label: "Profile", icon: "👤" },
    ];
    return isAdmin
      ? [...base, { id: "Admin", label: "Admin", icon: "⚙️" }]
      : base;
  }, [isAdmin]);

  const handleLoggedIn = useCallback((u) => {
    if (!u) return;
    setUser(u);
    setBalance(u.balance || 0);
  }, []);

  useEffect(() => {
    if (!user?.telegramId) return;
    let cancelled = false;

    getMe()
      .then((fresh) => {
        if (cancelled || !fresh) return;
        setUser((prev) => ({ ...prev, ...fresh }));
        if (fresh.balance !== undefined) setBalance(fresh.balance);
      })
      .catch((err) => console.warn("[App] getMe failed:", err?.message));

    return () => {
      cancelled = true;
    };
  }, [user?.telegramId]);

  const handleCartelaConfirm = useCallback((ids) => {
    setCardIds(ids);
    setShowCartela(false);
  }, []);

  const handleGameStatusChange = useCallback((status) => {
    setGameStatus(status);
    if (status === "active") {
      setShowCartela(false);
    }
  }, []);

  const handleLeave = useCallback(() => {
    setRoomCode(null);
    setCardIds([]);
    setShowCartela(false);
    setStakeAmount(10);
    setActiveTab("Game");
    setGameStatus("waiting");
  }, []);

  const handleGameEnded = useCallback(() => {
    setCardIds([]);
    setShowCartela(true);
    setGameStatus("waiting");
  }, []);

  if (!user) {
    return <Login onLoggedIn={handleLoggedIn} />;
  }

  const handlePlayStake = async (fee, code) => {
    setStakeAmount(fee);
    setRoomCode(code);
    let live = false;
    try {
      const room = await getRoom(code, 2500);
      live = room.status === "active";
    } catch (err) {
      console.warn("[App] room status check failed:", err.message);
    }
    if (live) {
      setCardIds([]);
      setShowCartela(false);
      setGameStatus("active");
    } else {
      setShowCartela(true);
      setGameStatus("waiting");
    }
  };

  return (
    <div className="app" style={{ paddingBottom: 80 }}>
      {activeTab === "Game" && (
        <>
          {showCartela && gameStatus === "waiting" ? (
            <CartelaSelection
              roomCode={roomCode}
              balance={balance}
              stake={stakeAmount}
              onConfirm={handleCartelaConfirm}
              onCancel={handleLeave}
              onGameStatusChange={handleGameStatusChange}
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
        <Wallet balance={balance} setBalance={setBalance} />
      )}

      {activeTab === "History" && <HistoryPage />}

      {activeTab === "Profile" && (
        <Profile
          user={user}
          balance={balance}
          onUserUpdate={(u) => {
            setUser((prev) => ({ ...prev, ...u }));
            if (u.balance !== undefined) setBalance(u.balance);
          }}
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
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

export default App;