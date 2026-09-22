import { useState, useEffect } from "react";
import Login from "./Login.jsx";
import Wallet from "./Wallet.jsx";
import GameLobby from "./Gamelobby.jsx";
import LiveGame from "./Livegame.jsx";
import CartelaSelection from "./Cartelaselection.jsx";
import AdminPanel from "./Adminpanel.jsx";
import Profile from "./Profile.jsx";
import { disconnectSocket } from "./socket";
import { useTelegram } from "./useTelegram";
import { getNotifications } from "./api";

const DEFAULT_ADMIN_IDS = ["494653076"];
const ENV_ADMIN_IDS = (process.env.REACT_APP_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ADMIN_IDS =
  ENV_ADMIN_IDS.length > 0 ? ENV_ADMIN_IDS : DEFAULT_ADMIN_IDS;

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

  // Poll notifications unread count
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
            <GameLobby onPlayStake={handlePlayStake} isAdmin={isAdmin} />
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