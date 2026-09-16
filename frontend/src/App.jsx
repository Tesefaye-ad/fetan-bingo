import React, { useState, useEffect, Suspense, lazy } from "react";
import Login from "./Login.jsx";
import Wallet from "./Wallet.jsx";
import GameLobby from "./Gamelobby.jsx";
import { disconnectSocket } from "./socket";

// ከባድ ገጾች - አስፈላጊ ሲሆኑ ብቻ እንዲጫኑ
const LiveGame = lazy(() => import("./Livegame.jsx"));
const CartelaSelection = lazy(() => import("./Cartelaselection.jsx"));

function App() {
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [roomCode, setRoomCode] = useState(null);
  const [cardId, setCardId] = useState(null);
  const [showCartela, setShowCartela] = useState(false);
  const [activeTab, setActiveTab] = useState("Game");
  const [adminStats, setAdminStats] = useState({ activeUsers: 0, registeredUsers: 0, totalGames: 0 });
  const [copySuccess, setCopySuccess] = useState(false);

  const ADMIN_TELEGRAM_IDS = ["494653076"];

  const isUserAdmin =
    (user && (user.isAdmin || user.role === "admin")) ||
    (user && user.telegramId && ADMIN_TELEGRAM_IDS.includes(String(user.telegramId)));

  const getTabs = () => {
    const tabs = [
      { id: "Game", label: "Game", icon: "🎮" },
      { id: "History", label: "History", icon: "📜" },
      { id: "Wallet", label: "Wallet", icon: "💳" },
      { id: "Profile", label: "Profile", icon: "👤" },
    ];
    if (isUserAdmin) tabs.push({ id: "Admin", label: "Admin", icon: "⚙️" });
    return tabs;
  };

  useEffect(() => {
    if (isUserAdmin && (activeTab === "Admin" || activeTab === "Game")) {
      const apiBase = process.env.REACT_APP_API_URL || "";
      const token = localStorage.getItem("bingo_token") || "";
      fetch(`${apiBase}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data && !data.error) {
            setAdminStats({
              activeUsers: data.activeUsers || 0,
              registeredUsers: data.registeredUsers || 0,
              totalGames: data.totalGames || 0,
            });
          }
        })
        .catch(() => {});
    }
  }, [user, activeTab, isUserAdmin]);

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

  function handleExitGame() {
    disconnectSocket();
    setRoomCode(null);
    setCardId(null);
  }

  function handleJoinRoom(code, selectedCardId) {
    setRoomCode(code);
    setCardId(selectedCardId);
  }

  function handlePlayStake(fee, code) {
    setRoomCode(code);
    setShowCartela(true);
  }

  function handleCartelaConfirm(selectedCardId) {
    setCardId(selectedCardId);
    setShowCartela(false);
  }

  const handleCopyInviteLink = () => {
    const botUsername = "fetanbingo1_bot";
    const inviteLink = `https://t.me/${botUsername}?start=ref_${user.telegramId}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    });
  };

  const tabs = getTabs();
  const userInitial = user.firstName
    ? user.firstName.charAt(0).toUpperCase()
    : user.username
    ? user.username.charAt(0).toUpperCase()
    : "U";

  return (
    <div className="app" style={{ paddingBottom: "80px" }}>
      <header className="app-header">
        <h1>🎱 Fetan Lottery</h1>
        <span>Hi, {user.firstName || user.username}</span>
      </header>

      {activeTab === "Game" && (
        <Suspense fallback={<div style={{ color: "#fff", textAlign: "center", padding: "50px" }}>Loading game...</div>}>
          <Wallet balance={balance} setBalance={setBalance} compact />
          {showCartela ? (
            <CartelaSelection
              roomCode={roomCode}
              balance={balance}
              onConfirm={handleCartelaConfirm}
              onCancel={() => setShowCartela(false)}
            />
          ) : roomCode ? (
            <LiveGame
              roomCode={roomCode}
              cardId={cardId}
              setBalance={setBalance}
              telegramId={user.telegramId}
              onExit={handleExitGame}
            />
          ) : (
            <GameLobby
              onJoin={handleJoinRoom}
              onPlayStake={handlePlayStake}
              isAdmin={isUserAdmin}
              adminStats={adminStats}
            />
          )}
        </Suspense>
      )}

      {activeTab === "History" && <Wallet balance={balance} setBalance={setBalance} showHistory />}

      {activeTab === "Wallet" && <Wallet balance={balance} setBalance={setBalance} />}

      {activeTab === "Profile" && (
        <div className="page-view profile-view" style={{ padding: "15px", textAlign: "center" }}>
          <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: "linear-gradient(135deg, #3498db, #2980b9)", color: "#fff", fontSize: "36px", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px auto", boxShadow: "0 4px 10px rgba(52, 152, 219, 0.3)", border: "2px solid #f39c12" }}>
            {userInitial}
          </div>
          <h2 style={{ color: "#fff", margin: "5px 0 2px 0", fontSize: "22px" }}>
            {user.firstName || "User"} {user.lastName || ""}
          </h2>
          <p style={{ color: "#f39c12", margin: "0 0 20px 0", fontSize: "14px" }}>
            {user.username ? `@${user.username}` : `@id_${user.telegramId}`}
          </p>

          <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
            <div style={{ flex: 1, background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "12px", padding: "15px" }}>
              <div style={{ color: "#f39c12", fontSize: "12px", marginBottom: "5px" }}>💳 Main Wallet</div>
              <div style={{ color: "#fff", fontSize: "18px", fontWeight: "bold" }}>{balance} ETB</div>
            </div>
            <div style={{ flex: 1, background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "12px", padding: "15px" }}>
              <div style={{ color: "#f39c12", fontSize: "12px", marginBottom: "5px" }}>🎁 Bonus</div>
              <div style={{ color: "#fff", fontSize: "18px", fontWeight: "bold" }}>{user.bonusBalance || 0} ETB</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
            <div style={{ flex: 1, background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "12px", padding: "15px" }}>
              <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "5px" }}>🏆 Games Won</div>
              <div style={{ color: "#fff", fontSize: "18px", fontWeight: "bold" }}>{user.gamesWon ?? 0}</div>
            </div>
            <div style={{ flex: 1, background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "12px", padding: "15px" }}>
              <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "5px" }}>👥 Total Invite</div>
              <div style={{ color: "#fff", fontSize: "18px", fontWeight: "bold" }}>{user.referralCount ?? 0}</div>
            </div>
          </div>

          <div style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: "14px", padding: "20px", textAlign: "center" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#f39c12", marginBottom: "8px" }}>
              🎁 ጓደኞች ይጋብዙ (Invite Friends)
            </div>
            <p style={{ color: "#bbb", fontSize: "12px", lineHeight: "1.5", marginBottom: "15px" }}>
              የእርስዎን የመጋበዣ ሊንክ ለጓደኞችዎ በመላክ በእያንዳንዱ ግንኙነት 5 ETB ቦነስ ያግኙ!
            </p>
            <button onClick={handleCopyInviteLink} style={{ width: "100%", background: "linear-gradient(135deg, #0088cc, #006699)", color: "#fff", border: "none", borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: "bold", cursor: "pointer", boxShadow: "0 4px 10px rgba(0, 136, 204, 0.3)" }}>
              🔗 {copySuccess ? "ተቀድቷል! (Copied!)" : "የመጋበዣ ሊንክ ቅዳ"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "Admin" && (
        <div className="page-view admin-panel" style={{ padding: "20px", textAlign: "center" }}>
          <h2 style={{ color: "#f39c12", marginBottom: "20px" }}>Admin Dashboard</h2>

          <div style={{ background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "12px", padding: "20px", marginBottom: "15px" }}>
            <h3 style={{ fontSize: "28px", color: "#fff", margin: "0 0 5px 0" }}>{adminStats.activeUsers}</h3>
            <p style={{ color: "#aaa", margin: 0, textTransform: "uppercase", fontSize: "12px", letterSpacing: "1px" }}>Active Users</p>
          </div>

          <div style={{ background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "12px", padding: "20px", marginBottom: "15px" }}>
            <h3 style={{ fontSize: "28px", color: "#fff", margin: "0 0 5px 0" }}>{adminStats.registeredUsers}</h3>
            <p style={{ color: "#aaa", margin: 0, textTransform: "uppercase", fontSize: "12px", letterSpacing: "1px" }}>Registered Users</p>
          </div>

          <div style={{ background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "12px", padding: "20px" }}>
            <h3 style={{ fontSize: "28px", color: "#fff", margin: "0 0 5px 0" }}>{adminStats.totalGames}</h3>
            <p style={{ color: "#aaa", margin: 0, textTransform: "uppercase", fontSize: "12px", letterSpacing: "1px" }}>Games Played</p>
          </div>
        </div>
      )}

      <nav className="bottom-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "nav-item active" : "nav-item"}
            onClick={() => { setActiveTab(tab.id); if (tab.id !== "Game") setShowCartela(false); }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;