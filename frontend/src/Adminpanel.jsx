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
} from "./api";

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState("Transactions");
  const [stats, setStats] = useState({
    activeUsers: 0,
    registeredUsers: 0,
    totalGames: 0,
    pendingDeposits: 0,
    pendingWithdrawals: 0,
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
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
        padding: "15px",
        maxWidth: "520px",
        margin: "0 auto",
        color: "#fff",
        paddingBottom: 100,
      }}
    >
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background:
              toast.type === "success"
                ? "#2ecc71"
                : toast.type === "error"
                ? "#e74c3c"
                : "#3498db",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 10,
            zIndex: 9999,
            fontWeight: "bold",
            fontSize: 13,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}
        >
          {toast.msg}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h2 style={{ color: "#f39c12", fontSize: 18, margin: 0 }}>
          ⚙️ Admin Panel
        </h2>
        <button
          onClick={() => {
            refreshStats();
            showToast("Refreshed", "success");
          }}
          style={{
            background: "#1a1a2e",
            border: "1px solid #f39c12",
            color: "#f39c12",
            padding: "6px 12px",
            borderRadius: 8,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Stats mini-cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          marginBottom: 12,
        }}
      >
        <MiniStat label="Active" value={stats.activeUsers} color="#2ecc71" />
        <MiniStat label="Users" value={stats.registeredUsers} color="#3498db" />
        <MiniStat label="Games" value={stats.totalGames} color="#f39c12" />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 12,
          overflowX: "auto",
        }}
      >
        {["Transactions", "Users", "Broadcast"].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              flex: 1,
              minWidth: 90,
              background: activeTab === t ? "#f39c12" : "#1a1a2e",
              color: activeTab === t ? "#111" : "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 5px",
              fontSize: 12,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === "Transactions" && (
        <TransactionsTab
          pendingD={stats.pendingDeposits}
          pendingW={stats.pendingWithdrawals}
          showToast={showToast}
          refreshStats={refreshStats}
        />
      )}
      {activeTab === "Users" && <UsersTab showToast={showToast} />}
      {activeTab === "Broadcast" && <BroadcastTab showToast={showToast} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// TRANSACTIONS TAB
// ═══════════════════════════════════════════════════════
function TransactionsTab({ pendingD, pendingW, showToast, refreshStats }) {
  const [type, setType] = useState("deposit");
  const [status, setStatus] = useState("pending");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetTransactions({ type, status, limit: 50 });
      setList(res.transactions || []);
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
      {/* Type toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <Toggle
          active={type === "deposit"}
          onClick={() => setType("deposit")}
          activeColor="#2ecc71"
        >
          💰 Deposit {pendingD > 0 && `(${pendingD})`}
        </Toggle>
        <Toggle
          active={type === "withdrawal"}
          onClick={() => setType("withdrawal")}
          activeColor="#e74c3c"
        >
          📤 Withdraw {pendingW > 0 && `(${pendingW})`}
        </Toggle>
      </div>

      {/* Status filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {["pending", "completed", "failed", "all"].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s === "all" ? "" : s)}
            style={{
              flex: 1,
              background: status === s ? "#f39c12" : "#1a1a2e",
              color: status === s ? "#111" : "#aaa",
              border: "1px solid #2a2a40",
              borderRadius: 6,
              padding: "6px 0",
              fontSize: 10,
              fontWeight: "bold",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: "center", color: "#888", padding: 20 }}>
          Loading...
        </div>
      )}

      {!loading && list.length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: "#888",
            padding: 40,
            border: "1px dashed #2a2a40",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          📭 No {status || "all"} {type}s
        </div>
      )}

      {list.map((tx) => (
        <div
          key={tx._id}
          style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a40",
            borderRadius: 10,
            padding: 12,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <div style={{ color: "#fff", fontWeight: "bold", fontSize: 13 }}>
              {tx.user?.firstName || tx.user?.username || "User"}
            </div>
            <div
              style={{
                color: tx.type === "deposit" ? "#2ecc71" : "#e74c3c",
                fontWeight: "bold",
                fontSize: 14,
              }}
            >
              {tx.amount} ETB
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
            ID: {tx.user?.telegramId} • 📞 {tx.user?.phone || "—"}
            <br />
            {new Date(tx.createdAt).toLocaleString()}
            {tx.reference && <> • Ref: {tx.reference}</>}
          </div>

          {tx.status === "pending" && (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => approve(tx._id)}
                style={{
                  flex: 1,
                  background: "#2ecc71",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px",
                  fontWeight: "bold",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                ✅ Approve
              </button>
              <button
                onClick={() => reject(tx._id)}
                style={{
                  flex: 1,
                  background: "#e74c3c",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px",
                  fontWeight: "bold",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                ❌ Reject
              </button>
            </div>
          )}
          {tx.status !== "pending" && (
            <div
              style={{
                textAlign: "center",
                fontSize: 11,
                color: tx.status === "completed" ? "#2ecc71" : "#e74c3c",
                fontWeight: "bold",
                textTransform: "uppercase",
              }}
            >
              {tx.status}
            </div>
          )}
        </div>
      ))}
    </>
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
      const res = await adminGetUsers({ q, limit: 50 });
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

  const adjustBalance = async (u) => {
    const amount = window.prompt(`Adjust balance for ${u.firstName}:`);
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
        placeholder="🔍 Search by ID, username, phone..."
        style={{
          width: "100%",
          background: "#12121e",
          border: "1px solid #2a2a40",
          borderRadius: 8,
          padding: 10,
          color: "#fff",
          fontSize: 13,
          boxSizing: "border-box",
          marginBottom: 12,
        }}
      />

      {loading && (
        <div style={{ textAlign: "center", color: "#888", padding: 20 }}>
          Loading...
        </div>
      )}

      {!loading && list.length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: "#888",
            padding: 40,
            border: "1px dashed #2a2a40",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          No users found
        </div>
      )}

      {list.map((u) => (
        <div
          key={u._id}
          style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a40",
            borderRadius: 10,
            padding: 12,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <div style={{ color: "#fff", fontWeight: "bold", fontSize: 13 }}>
              {u.firstName || u.username || "User"}{" "}
              {u.isAdmin && "👑"}
              {u.isBanned && " 🚫"}
            </div>
            <div
              style={{ color: "#2ecc71", fontWeight: "bold", fontSize: 13 }}
            >
              {u.balance} ETB
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
            ID: {u.telegramId}
            {u.phone && <> • 📞 {u.phone}</>}
            <br />
            Games: {u.gamesPlayed} • Won: {u.gamesWon} • Winnings:{" "}
            {u.totalWinnings} ETB
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => adjustBalance(u)}
              style={{
                flex: 1,
                background: "#3498db",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "6px",
                fontWeight: "bold",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              💰 Adjust
            </button>
            <button
              onClick={() => toggleBan(u)}
              style={{
                flex: 1,
                background: u.isBanned ? "#2ecc71" : "#e74c3c",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "6px",
                fontWeight: "bold",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {u.isBanned ? "✅ Unban" : "🚫 Ban"}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════
// BROADCAST TAB
// ═══════════════════════════════════════════════════════
function BroadcastTab({ showToast }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      showToast("Title and body required", "error");
      return;
    }
    setSending(true);
    try {
      await adminBroadcast(title, body);
      showToast("📢 Broadcast sent!", "success");
      setTitle("");
      setBody("");
    } catch (e) {
      showToast("Failed to broadcast", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        style={{
          width: "100%",
          background: "#12121e",
          border: "1px solid #2a2a40",
          borderRadius: 8,
          padding: 10,
          color: "#fff",
          fontSize: 13,
          boxSizing: "border-box",
          marginBottom: 8,
        }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message body..."
        rows={5}
        style={{
          width: "100%",
          background: "#12121e",
          border: "1px solid #2a2a40",
          borderRadius: 8,
          padding: 10,
          color: "#fff",
          fontSize: 13,
          boxSizing: "border-box",
          marginBottom: 12,
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <button
        onClick={send}
        disabled={sending}
        style={{
          width: "100%",
          background: sending
            ? "#555"
            : "linear-gradient(135deg,#f39c12,#e67e22)",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: 14,
          fontWeight: "bold",
          fontSize: 14,
          cursor: sending ? "not-allowed" : "pointer",
        }}
      >
        {sending ? "Sending..." : "📢 Send to All Users"}
      </button>
    </>
  );
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════
function MiniStat({ label, value, color }) {
  return (
    <div
      style={{
        background: "#1a1a2e",
        border: "1px solid #2a2a40",
        borderRadius: 10,
        padding: "8px 4px",
        textAlign: "center",
      }}
    >
      <div style={{ color, fontSize: 18, fontWeight: "bold" }}>{value}</div>
      <div style={{ color: "#aaa", fontSize: 10 }}>{label}</div>
    </div>
  );
}

function Toggle({ active, onClick, children, activeColor }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? activeColor : "#1a1a2e",
        color: active ? "#fff" : "#aaa",
        border: "none",
        borderRadius: 10,
        padding: "10px",
        fontWeight: "bold",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}