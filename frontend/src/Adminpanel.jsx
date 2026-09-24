import React, { useState, useEffect, useCallback } from "react";
import {
  adminGetStats,
  adminGetTransactions,
  adminApproveTransaction,
  adminRejectTransaction,
  adminGetUsers,
  adminBanUser,
  adminBroadcast,
  adminAdjustBalance,
  adminGetConfig,
  adminSaveConfig,
  adminSetDrawNumber,
  adminClearDrawNumber,
} from "./api";

// ═══════════════════════════════════════════════════════
// COLORS
// ═══════════════════════════════════════════════════════
const C = {
  bg: "#0a0a14",
  card: "#151529",
  card2: "#1a1a30",
  border: "#2a2a45",
  orange: "#f39c12",
  orangeDark: "#e67e22",
  blue: "#3498db",
  green: "#2ecc71",
  red: "#e74c3c",
  text: "#fff",
  textDim: "#888",
};

// ═══════════════════════════════════════════════════════
// MAIN ADMIN PANEL
// ═══════════════════════════════════════════════════════
export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState("txns");
  const [stats, setStats] = useState({
    activeUsers: 0,
    registeredUsers: 0,
    totalGames: 0,
    pendingDeposits: 0,
    pendingWithdrawals: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    houseCommission: 0,
  });
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const refreshStats = useCallback(async () => {
    try {
      const s = await adminGetStats();
      setStats(s);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats, activeTab]);

  return (
    <div
      style={{
        padding: "12px",
        maxWidth: "520px",
        margin: "0 auto",
        color: C.text,
        paddingBottom: 100,
        background: C.bg,
        minHeight: "100vh",
      }}
    >
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background:
              toast.type === "success"
                ? C.green
                : toast.type === "error"
                ? C.red
                : C.blue,
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 10,
            zIndex: 9999,
            fontWeight: "bold",
            fontSize: 13,
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            color: C.orange,
            fontSize: 20,
            margin: 0,
            fontWeight: "900",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          ⚙️ Admin Panel
        </h2>
        <button
          onClick={() => {
            refreshStats();
            showToast("Refreshed", "success");
          }}
          style={{
            background: C.card,
            border: `1px solid ${C.blue}66`,
            color: C.blue,
            padding: "6px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Main Tabs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
          marginBottom: 6,
        }}
      >
        {[
          { id: "txns", label: "💵 Tnxs" },
          { id: "stats", label: "📊 Stats" },
          { id: "users", label: "Users" },
          { id: "draw", label: "Draw" },
        ].map((t) => (
          <TabBtn
            key={t.id}
            active={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </TabBtn>
        ))}
      </div>

      {/* Second Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 6,
          marginBottom: 12,
        }}
      >
        <TabBtn
          active={activeTab === "config"}
          onClick={() => setActiveTab("config")}
        >
          Config
        </TabBtn>
        <TabBtn
          active={activeTab === "broadcast"}
          onClick={() => setActiveTab("broadcast")}
        >
          📢
        </TabBtn>
      </div>

      {/* Tab Content */}
      {activeTab === "txns" && (
        <TxnsTab showToast={showToast} refreshStats={refreshStats} />
      )}
      {activeTab === "stats" && <StatsTab stats={stats} />}
      {activeTab === "users" && <UsersTab showToast={showToast} />}
      {activeTab === "draw" && <DrawTab showToast={showToast} />}
      {activeTab === "config" && <ConfigTab showToast={showToast} />}
      {activeTab === "broadcast" && <BroadcastTab showToast={showToast} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// TAB BUTTON
// ═══════════════════════════════════════════════════════
function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active
          ? `linear-gradient(135deg, ${C.orange}, ${C.orangeDark})`
          : C.card,
        color: active ? "#000" : "#fff",
        border: active ? `1px solid ${C.orange}` : `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "10px 6px",
        fontSize: 12,
        fontWeight: "bold",
        cursor: "pointer",
        boxShadow: active ? `0 0 15px ${C.orange}66` : "none",
        transition: "all 0.2s",
      }}
    >
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════
// TXNS TAB
// ═══════════════════════════════════════════════════════
function TxnsTab({ showToast, refreshStats }) {
  const [type, setType] = useState("deposit");
  const [status, setStatus] = useState("pending");
  const [list, setList] = useState([]);
  const [counts, setCounts] = useState({
    pending: 0,
    completed: 0,
    failed: 0,
    all: 0,
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetTransactions({
        type,
        status: status === "all" ? "" : status,
        limit: 100,
      });
      setList(res.transactions || []);
      if (res.statusCounts) setCounts(res.statusCounts);
    } catch (e) {
      showToast("Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, [type, status, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (id) => {
    try {
      await adminApproveTransaction(id);
      showToast("✅ Approved", "success");
      load();
      refreshStats();
    } catch (e) {
      showToast(e?.response?.data?.error || "Failed", "error");
    }
  };

  const reject = async (id) => {
    const reason = window.prompt("Rejection reason (optional):");
    if (reason === null) return;
    try {
      await adminRejectTransaction(id, reason);
      showToast("❌ Rejected", "success");
      load();
      refreshStats();
    } catch (e) {
      showToast(e?.response?.data?.error || "Failed", "error");
    }
  };

  return (
    <>
      {/* Deposits / Withdrawals toggle */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
          marginBottom: 8,
        }}
      >
        <button
          onClick={() => setType("deposit")}
          style={{
            background: type === "deposit" ? C.blue : C.card,
            color: "#fff",
            border: type === "deposit" ? `1px solid ${C.blue}` : `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "10px",
            fontSize: 12,
            fontWeight: "bold",
            cursor: "pointer",
            boxShadow: type === "deposit" ? `0 0 15px ${C.blue}66` : "none",
          }}
        >
          💰 Deposits
        </button>
        <button
          onClick={() => setType("withdrawal")}
          style={{
            background: type === "withdrawal" ? C.blue : C.card,
            color: "#fff",
            border:
              type === "withdrawal" ? `1px solid ${C.blue}` : `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "10px",
            fontSize: 12,
            fontWeight: "bold",
            cursor: "pointer",
            boxShadow:
              type === "withdrawal" ? `0 0 15px ${C.blue}66` : "none",
          }}
        >
          📤 Withdrawals
        </button>
      </div>

      {/* Status Filter */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
          marginBottom: 12,
        }}
      >
        {[
          { id: "pending", label: `PENDING (${counts.pending})` },
          { id: "completed", label: `APPROVED (${counts.completed})` },
          { id: "failed", label: `REJECTED (${counts.failed})` },
          { id: "all", label: `ALL (${counts.all})` },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setStatus(s.id)}
            style={{
              background: status === s.id ? C.orange : C.card,
              color: status === s.id ? "#000" : C.textDim,
              border: `1px solid ${status === s.id ? C.orange : C.border}`,
              borderRadius: 8,
              padding: "8px 4px",
              fontSize: 9,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: "center", color: C.textDim, padding: 20 }}>
          Loading...
        </div>
      )}

      {!loading && list.length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: C.textDim,
            padding: 60,
            border: `1px dashed ${C.border}`,
            borderRadius: 12,
            fontSize: 14,
          }}
        >
          📭 ምንም አልተመዘገበ
        </div>
      )}

      {list.map((tx) => (
        <TxCard
          key={tx._id}
          tx={tx}
          onApprove={() => approve(tx._id)}
          onReject={() => reject(tx._id)}
        />
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════
// TX CARD
// ═══════════════════════════════════════════════════════
function TxCard({ tx, onApprove, onReject }) {
  const isDeposit = tx.type === "deposit";
  const statusColor =
    tx.status === "completed"
      ? C.green
      : tx.status === "failed"
      ? C.red
      : C.orange;

  const dateStr = new Date(tx.createdAt).toLocaleString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            color: isDeposit ? C.green : C.red,
            fontSize: 12,
            fontWeight: "bold",
            letterSpacing: 0.5,
          }}
        >
          {isDeposit ? "💰 DEPOSIT" : "⚠ WITHDRAWAL"}
        </div>
        <div
          style={{
            background: statusColor,
            color: tx.status === "completed" ? "#000" : "#fff",
            borderRadius: 20,
            padding: "3px 10px",
            fontSize: 9,
            fontWeight: "bold",
            letterSpacing: 0.5,
          }}
        >
          {tx.status.toUpperCase()}
        </div>
      </div>

      {/* Amount */}
      <div
        style={{
          color: "#ffd43b",
          fontSize: 24,
          fontWeight: "900",
          marginBottom: 8,
        }}
      >
        {tx.amount} ETB
      </div>

      {/* User info */}
      <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8 }}>
        <div style={{ color: "#fff" }}>
          👤 {tx.user?.firstName || tx.user?.username || "Unknown"} (ID:{" "}
          {tx.user?.telegramId || "—"})
        </div>
        {tx.user?.phone && (
          <div style={{ color: C.blue }}>📱 {tx.user.phone}</div>
        )}
        {tx.meta?.phone && !tx.user?.phone && (
          <div style={{ color: C.blue }}>📱 {tx.meta.phone}</div>
        )}
        <div style={{ color: C.orange }}>🏆 {tx.user?.telegramId || "—"}</div>
        <div>🕐 {dateStr}</div>
      </div>

      {/* Actions */}
      {tx.status === "pending" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={onApprove}
            style={{
              flex: 1,
              background: C.green,
              color: "#000",
              border: "none",
              borderRadius: 8,
              padding: "10px",
              fontWeight: "bold",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ✅ Approve
          </button>
          <button
            onClick={onReject}
            style={{
              flex: 1,
              background: C.red,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px",
              fontWeight: "bold",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ❌ Reject
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// STATS TAB
// ═══════════════════════════════════════════════════════
function StatsTab({ stats }) {
  return (
    <>
      <div
        style={{
          color: "#ffd43b",
          fontSize: 18,
          fontWeight: "900",
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        📊 Financial Dashboard
      </div>

      {/* Deposits / Withdrawals */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            background: `${C.green}11`,
            border: `1px solid ${C.green}55`,
            borderRadius: 14,
            padding: 18,
            textAlign: "center",
            boxShadow: `0 0 20px ${C.green}22`,
          }}
        >
          <div style={{ color: C.textDim, fontSize: 12, marginBottom: 6 }}>
            ገቢ (Deposit)
          </div>
          <div
            style={{
              color: C.green,
              fontSize: 26,
              fontWeight: "900",
              textShadow: `0 0 20px ${C.green}88`,
            }}
          >
            {stats.totalDeposits}{" "}
            <span style={{ fontSize: 14, color: "#fff" }}>ETB</span>
          </div>
        </div>

        <div
          style={{
            background: `${C.red}11`,
            border: `1px solid ${C.red}55`,
            borderRadius: 14,
            padding: 18,
            textAlign: "center",
            boxShadow: `0 0 20px ${C.red}22`,
          }}
        >
          <div style={{ color: C.textDim, fontSize: 12, marginBottom: 6 }}>
            ወጪ (Withdrawal)
          </div>
          <div
            style={{
              color: C.red,
              fontSize: 26,
              fontWeight: "900",
              textShadow: `0 0 20px ${C.red}88`,
            }}
          >
            {stats.totalWithdrawals}{" "}
            <span style={{ fontSize: 14, color: "#fff" }}>ETB</span>
          </div>
        </div>
      </div>

      {/* House Commission */}
      <div
        style={{
          background: `${C.orange}11`,
          border: `1px solid ${C.orange}`,
          borderRadius: 14,
          padding: 22,
          textAlign: "center",
          marginBottom: 20,
          boxShadow: `0 0 30px ${C.orange}33, inset 0 0 30px ${C.orange}11`,
        }}
      >
        <div
          style={{
            color: C.textDim,
            fontSize: 11,
            marginBottom: 8,
            letterSpacing: 1.5,
          }}
        >
          HOUSE NET COMMISSION
        </div>
        <div
          style={{
            color: "#ffd43b",
            fontSize: 36,
            fontWeight: "900",
            textShadow: `0 0 30px ${C.orange}`,
          }}
        >
          {stats.houseCommission}{" "}
          <span style={{ fontSize: 16, color: "#fff" }}>ETB</span>
        </div>
      </div>

      {/* Other stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
        }}
      >
        <SmallStat label="Active" value={stats.activeUsers} color={C.green} />
        <SmallStat
          label="Registered"
          value={stats.registeredUsers}
          color={C.blue}
        />
        <SmallStat
          label="Total Games"
          value={stats.totalGames}
          color={C.orange}
        />
        <SmallStat
          label="Pending Txs"
          value={stats.pendingDeposits + stats.pendingWithdrawals}
          color={C.red}
        />
      </div>
    </>
  );
}

function SmallStat({ label, value, color }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${color}44`,
        borderRadius: 12,
        padding: 14,
        textAlign: "center",
      }}
    >
      <div style={{ color, fontSize: 20, fontWeight: "900" }}>{value}</div>
      <div style={{ color: C.textDim, fontSize: 11, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════
function UsersTab({ showToast }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetUsers({ q, limit: 100 });
      setList(res.users || []);
    } catch (e) {
      showToast("Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }, [q, showToast]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const toggleBan = async (u) => {
    try {
      await adminBanUser(u._id, !u.isBanned);
      showToast(u.isBanned ? "Unbanned" : "Banned", "success");
      load();
    } catch (e) {
      showToast("Failed", "error");
    }
  };

  const editBalance = async (u) => {
    const amount = window.prompt(
      `Adjust balance for ${u.firstName || u.username}\nCurrent: ${u.balance} ETB\n\nEnter amount (use - for subtract):`
    );
    if (!amount) return;
    const note = window.prompt("Note (optional):") || "";
    try {
      await adminAdjustBalance(u._id, Number(amount), note);
      showToast("Balance adjusted", "success");
      load();
    } catch (e) {
      showToast("Failed", "error");
    }
  };

  return (
    <>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔍 የተጠቃሚ ID ወይም ስልክ ፃፍ..."
        style={{
          width: "100%",
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 14,
          color: "#fff",
          fontSize: 13,
          boxSizing: "border-box",
          marginBottom: 12,
          outline: "none",
        }}
      />

      {loading && (
        <div style={{ textAlign: "center", color: C.textDim, padding: 20 }}>
          Loading...
        </div>
      )}

      {!loading && list.length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: C.textDim,
            padding: 60,
            border: `1px dashed ${C.border}`,
            borderRadius: 12,
            fontSize: 14,
          }}
        >
          No users found
        </div>
      )}

      {list.map((u) => (
        <UserCard
          key={u._id}
          user={u}
          onEdit={() => editBalance(u)}
          onBan={() => toggleBan(u)}
        />
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════
// USER CARD
// ═══════════════════════════════════════════════════════
function UserCard({ user, onEdit, onBan }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
      }}
    >
      {/* Left info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: "900",
            color: "#5b9bd5",
            marginBottom: 6,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {user.firstName || user.username || "User"}{" "}
          <span style={{ color: C.textDim, fontSize: 12 }}>
            (ID: {user.telegramId})
          </span>
          {user.isAdmin && " 👑"}
          {user.isBanned && " 🚫"}
        </div>

        {user.phone && (
          <div style={{ color: "#5b9bd5", fontSize: 12, marginBottom: 4 }}>
            📱 {user.phone}
          </div>
        )}

        <div style={{ fontSize: 12 }}>
          💰 <span style={{ color: C.orange }}>{user.balance}</span>
          <span style={{ color: C.textDim }}> | </span>
          🎮 <span style={{ color: C.green }}>{user.totalWinnings || 0} ETB</span>
        </div>
      </div>

      {/* Right buttons */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onEdit}
          style={{
            background: C.blue,
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: "bold",
            cursor: "pointer",
            minWidth: 80,
          }}
        >
          ✏ Edit
        </button>
        <button
          onClick={onBan}
          style={{
            background: user.isBanned ? C.green : C.red,
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: "bold",
            cursor: "pointer",
            minWidth: 80,
          }}
        >
          {user.isBanned ? "✓ Unban" : "✕ Ban"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DRAW TAB
// ═══════════════════════════════════════════════════════
function DrawTab({ showToast }) {
  const [num, setNum] = useState("");
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    adminGetConfig()
      .then((c) => setCurrent(c.forcedWinNumber))
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!num) return showToast("Enter a number", "error");
    try {
      await adminSetDrawNumber(Number(num));
      setCurrent(Number(num));
      showToast("✅ Saved", "success");
      setNum("");
    } catch (e) {
      showToast(e?.response?.data?.error || "Failed", "error");
    }
  };

  const clear = async () => {
    try {
      await adminClearDrawNumber();
      setCurrent(null);
      showToast("Cleared", "success");
    } catch (e) {
      showToast("Failed", "error");
    }
  };

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.orange}66`,
        borderRadius: 14,
        padding: 18,
        boxShadow: `0 0 25px ${C.orange}22`,
      }}
    >
      <div
        style={{
          color: "#ffd43b",
          fontSize: 16,
          fontWeight: "900",
          marginBottom: 14,
        }}
      >
        🎯 የቁጥር ማውጫ መቆጣጠሪያ
      </div>

      {current && (
        <div
          style={{
            background: `${C.green}22`,
            border: `1px solid ${C.green}`,
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
            textAlign: "center",
            fontSize: 13,
            color: C.green,
            fontWeight: "bold",
          }}
        >
          🎯 Current forced: #{current}
          <button
            onClick={clear}
            style={{
              marginLeft: 12,
              background: C.red,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      )}

      <input
        type="number"
        value={num}
        onChange={(e) => setNum(e.target.value)}
        placeholder="የማሸነፊያ ቁጥር አስገባ (1-1250)"
        style={{
          width: "100%",
          background: "#000",
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 14,
          color: "#fff",
          fontSize: 14,
          boxSizing: "border-box",
          marginBottom: 12,
          outline: "none",
        }}
      />

      <button
        onClick={save}
        style={{
          width: "100%",
          background: `linear-gradient(135deg, ${C.orange}, ${C.orangeDark})`,
          color: "#000",
          border: "none",
          borderRadius: 10,
          padding: 14,
          fontSize: 14,
          fontWeight: "900",
          cursor: "pointer",
          boxShadow: `0 0 20px ${C.orange}66`,
        }}
      >
        ✓ መደብ አስቀምጥ
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// CONFIG TAB
// ═══════════════════════════════════════════════════════
function ConfigTab({ showToast }) {
  const [ticketPrice, setTicketPrice] = useState(10);
  const [winnerPercent, setWinnerPercent] = useState(80);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGetConfig()
      .then((c) => {
        setTicketPrice(c.ticketPrice || 10);
        setWinnerPercent(c.winnerPercent || 80);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try {
      await adminSaveConfig(Number(ticketPrice), Number(winnerPercent));
      showToast("✅ Saved", "success");
    } catch (e) {
      showToast("Failed", "error");
    }
  };

  if (loading) return <div style={{ color: C.textDim }}>Loading...</div>;

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.orange}66`,
        borderRadius: 14,
        padding: 18,
        boxShadow: `0 0 25px ${C.orange}22`,
      }}
    >
      <div
        style={{
          color: "#ffd43b",
          fontSize: 16,
          fontWeight: "900",
          marginBottom: 14,
        }}
      >
        ⚙️ የስርዓት ማስተካከያዎች
      </div>

      <label
        style={{
          display: "block",
          color: C.textDim,
          fontSize: 13,
          marginBottom: 8,
        }}
      >
        የቲኬት ዋጋ (Ticket Price):
      </label>
      <input
        type="number"
        value={ticketPrice}
        onChange={(e) => setTicketPrice(e.target.value)}
        style={{
          width: "100%",
          background: "#000",
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 14,
          color: "#fff",
          fontSize: 15,
          boxSizing: "border-box",
          marginBottom: 16,
          outline: "none",
        }}
      />

      <label
        style={{
          display: "block",
          color: C.textDim,
          fontSize: 13,
          marginBottom: 8,
        }}
      >
        የአሸናፊው ድርሻ በመቶኛ (Winner %):
      </label>
      <input
        type="number"
        value={winnerPercent}
        onChange={(e) => setWinnerPercent(e.target.value)}
        style={{
          width: "100%",
          background: "#000",
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 14,
          color: "#fff",
          fontSize: 15,
          boxSizing: "border-box",
          marginBottom: 16,
          outline: "none",
        }}
      />

      <button
        onClick={save}
        style={{
          width: "100%",
          background: C.green,
          color: "#000",
          border: "none",
          borderRadius: 10,
          padding: 14,
          fontSize: 14,
          fontWeight: "900",
          cursor: "pointer",
          boxShadow: `0 0 20px ${C.green}66`,
        }}
      >
        💾 ቅንብሮችን አስቀምጥ
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// BROADCAST TAB
// ═══════════════════════════════════════════════════════
function BroadcastTab({ showToast }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!body.trim()) return showToast("Enter message", "error");
    setSending(true);
    try {
      await adminBroadcast("📢 Announcement", body);
      showToast("📢 Sent to all users!", "success");
      setBody("");
    } catch (e) {
      showToast("Failed", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.blue}66`,
        borderRadius: 14,
        padding: 18,
        boxShadow: `0 0 25px ${C.blue}22`,
      }}
    >
      <div
        style={{
          color: "#5b9bd5",
          fontSize: 16,
          fontWeight: "900",
          marginBottom: 14,
        }}
      >
        📢 ለሁሉም ተጠቃሚዎች መልእክት ላክ
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="መልእክትዎን እዚህ ይጻፉ..."
        rows={5}
        style={{
          width: "100%",
          background: "#000",
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 14,
          color: "#fff",
          fontSize: 14,
          boxSizing: "border-box",
          marginBottom: 12,
          resize: "vertical",
          fontFamily: "inherit",
          outline: "none",
        }}
      />

      <button
        onClick={send}
        disabled={sending}
        style={{
          width: "100%",
          background: sending ? "#555" : C.blue,
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: 14,
          fontSize: 14,
          fontWeight: "900",
          cursor: sending ? "not-allowed" : "pointer",
          boxShadow: sending ? "none" : `0 0 20px ${C.blue}66`,
        }}
      >
        {sending ? "Sending..." : "📤 መልእክት አስተላልፍ"}
      </button>
    </div>
  );
}