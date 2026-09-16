import React, { useState } from "react";

export default function AdminPanel({ adminStats }) {
  const [activeTab, setActiveTab] = useState("Transactions");
  const [transactionType, setTransactionType] = useState("Deposit");
  const [statusFilter, setStatusFilter] = useState("PENDING");

  return (
    <div style={{ padding: "15px", maxWidth: "480px", margin: "0 auto", color: "#fff" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
        <h2 style={{ color: "#f39c12", fontSize: "18px", margin: 0 }}>⚙️ Admin Panel (Super Admin)</h2>
        <button style={{ background: "#1a1a2e", border: "1px solid #f39c12", color: "#f39c12", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", cursor: "pointer" }}>
          🔄 Refresh
        </button>
      </div>

      {/* Menu Buttons */}
      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "10px" }}>
        {["Transactions", "Dashboard", "Users", "Draw", "Settings"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, background: activeTab === tab ? "#f39c12" : "#1a1a2e",
              color: activeTab === tab ? "#111" : "#fff", border: "none",
              borderRadius: "8px", padding: "10px 5px", fontSize: "11px", fontWeight: "bold", cursor: "pointer"
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Broadcast Button */}
      <button style={{ width: "100%", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "8px", padding: "12px", fontWeight: "bold", fontSize: "13px", marginBottom: "15px", cursor: "pointer" }}>
        Broadcast
      </button>

      {/* Deposit / Withdrawal Toggles */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
        <button
          onClick={() => setTransactionType("Deposit")}
          style={{
            flex: 1, background: transactionType === "Deposit" ? "#2ecc71" : "#1a1a2e",
            color: transactionType === "Deposit" ? "#fff" : "#aaa", border: "none",
            borderRadius: "10px", padding: "12px", fontWeight: "bold", fontSize: "13px", cursor: "pointer"
          }}
        >
          💰 የተከፈሉ ጥያቄዎች (Deposit)
        </button>
        <button
          onClick={() => setTransactionType("Withdrawal")}
          style={{
            flex: 1, background: transactionType === "Withdrawal" ? "#e74c3c" : "#1a1a2e",
            color: transactionType === "Withdrawal" ? "#fff" : "#aaa", border: "none",
            borderRadius: "10px", padding: "12px", fontWeight: "bold", fontSize: "13px", cursor: "pointer"
          }}
        >
          📤 የወጡ ጥያቄዎች (Withdrawal)
        </button>
      </div>

      {/* Status Filters */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {["PENDING", "APPROVED", "REJECTED", "ALL"].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              flex: 1, background: statusFilter === status ? "#f39c12" : "#1a1a2e",
              color: statusFilter === status ? "#111" : "#aaa", border: "1px solid #2a2a40",
              borderRadius: "8px", padding: "8px 0", fontSize: "10px", fontWeight: "bold", cursor: "pointer"
            }}
          >
            {status} (0)
          </button>
        ))}
      </div>

      {/* Empty State */}
      <div style={{ textAlign: "center", color: "#888", fontSize: "14px", padding: "40px 0", borderBottom: "1px solid #2a2a40", marginBottom: "20px" }}>
        ማንም አገኘ አልተመዘገበ
      </div>

      {/* Bottom Stats */}
      <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
        <div>
          <div style={{ color: "#fff", fontSize: "22px", fontWeight: "bold" }}>{adminStats?.activeUsers ?? 0}</div>
          <div style={{ color: "#aaa", fontSize: "11px" }}>Active Users</div>
        </div>
        <div>
          <div style={{ color: "#fff", fontSize: "22px", fontWeight: "bold" }}>{adminStats?.registeredUsers ?? 0}</div>
          <div style={{ color: "#aaa", fontSize: "11px" }}>Registered Users</div>
        </div>
      </div>
    </div>
  );
}