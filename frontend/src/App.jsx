import { useState, useEffect } from "react";
import Login from "./Login.jsx";
import Wallet from "./Wallet.jsx";
import GameLobby from "./Gamelobby.jsx";
import LiveGame from "./Livegame.jsx";
import CartelaSelection from "./Cartelaselection.jsx";
import AdminPanel from "./Adminpanel.jsx";
import { disconnectSocket } from "./socket";
import { useTelegram } from "./useTelegram";

function App() {
  useTelegram();

  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [roomCode, setRoomCode] = useState(null);
  const [cardIds, setCardIds] = useState([]);
  const [showCartela, setShowCartela] = useState(false);
  const [stakeAmount, setStakeAmount] = useState(10);
  const [activeTab, setActiveTab] = useState("Game");
  const [adminStats, setAdminStats] = useState({
    activeUsers: 0,
    registeredUsers: 0,
    totalGames: 0,
  });

  const ADMIN_IDS = ["494653076"];
  const isAdmin =
    user?.isAdmin ||
    (user?.telegramId && ADMIN_IDS.includes(String(user.telegramId)));

  const tabs = [
    { id: "Game", label: "Game", icon: "🎮" },
    { id: "Wallet", label: "Wallet", icon: "💳" },
    { id: "Profile", label: "Profile", icon: "👤" },
  ];
  if (isAdmin) tabs.push({ id: "Admin", label: "Admin", icon: "⚙️" });

  useEffect(() => {
    if (!isAdmin) return;
    const base = process.env.REACT_APP_API_URL || "";
    const token = localStorage.getItem("bingo_token") || "";
    fetch(`${base}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d && !d.error) setAdminStats(d);
      })
      .catch(() => {});
  }, [isAdmin, activeTab]);

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

  // Play stake → open cartela selection
  function handlePlayStake(fee, code) {
    setStakeAmount(fee);
    setRoomCode(code);
    setShowCartela(true);
  }

  // Cartela chosen → open live game
  function handleCartelaConfirm(ids) {
    setCardIds(ids);
    setShowCartela(false);
  }

  // Leave → back to lobby
  function handleLeave() {
    disconnectSocket();
    setRoomCode(null);
    setCardIds([]);
    setShowCartela(false);
    setStakeAmount(10);
    setActiveTab("Game");
  }

  // Game ended → 5s → back to cartela selection
  function handleGameEnded() {
    disconnectSocket();
    setCardIds([]);
    setShowCartela(true);
  }

  const userInitial = (user.firstName || user.username || "U").charAt(0).toUpperCase();

  return (
    <div className="app" style={{ paddingBottom: 80 }}>
      {!showCartela && !roomCode && (
        <header className="app-header">
          <h1>🎱 Fetan Bingo</h1>
          <span>Hi, {user.firstName || user.username}</span>
        </header>
      )}

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
            <GameLobby
              onPlayStake={handlePlayStake}
              isAdmin={isAdmin}
              adminStats={adminStats}
            />
          )}
        </>
      )}

      {activeTab === "Wallet" && <Wallet balance={balance} setBalance={setBalance} />}

      {activeTab === "Profile" && (
        <div style={{ padding: 15, textAlign: "center", color: "#fff" }}>
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
            {userInitial}
          </div>
          <h2 style={{ color: "#fff", margin: "5px 0" }}>
            {user.firstName || "User"} {user.lastName || ""}
          </h2>
          <p style={{ color: "#f39c12", marginBottom: 20 }}>
            {user.username ? `@${user.username}` : `@id_${user.telegramId}`}
          </p>
          <div style={{ display: "flex", gap: 10, marginBottom: 15 }}>
            <div style={{ flex: 1, background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: 12, padding: 15 }}>
              <div style={{ color: "#f39c12", fontSize: 12 }}>💳 Main Wallet</div>
              <div style={{ color: "#fff", fontSize: 18, fontWeight: "bold" }}>{balance} ETB</div>
            </div>
            <div style={{ flex: 1, background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: 12, padding: 15 }}>
              <div style={{ color: "#f39c12", fontSize: 12 }}>🏆 Games Won</div>
              <div style={{ color: "#fff", fontSize: 18, fontWeight: "bold" }}>{user.gamesWon || 0}</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "Admin" && <AdminPanel adminStats={adminStats} />}

      {!showCartela && !roomCode && (
        <nav className="bottom-nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={activeTab === t.id ? "nav-item active" : "nav-item"}
              onClick={() => setActiveTab(t.id)}
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