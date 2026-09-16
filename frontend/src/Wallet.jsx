import React, { useState } from "react";
import { initiateDeposit, withdraw as withdrawApi } from "./api";

function Wallet({ balance, setBalance, showHistory }) {
  const [amount, setAmount] = useState("");
  const [smsText, setSmsText] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

   const handleDeposit = async (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      setMessage("እባክዎ ትክክለኛ የብር መጠን ያስገቡ።");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const data = await initiateDeposit(Number(amount));
      setMessage(`✅ ${data.message || "የዲፖዚት ጥያቄዎ ተልኳል!"}\nReference: ${data.reference}`);
      setAmount("");
      setSmsText("");
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || "ሊሳካ አልቻለም";
      setMessage(`❌ ስህተት: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    if (!withdrawAmount || Number(withdrawAmount) <= 0) {
      setMessage("እባክዎ ማውጣት የሚፈልጉትን ትክክለኛ የብር መጠን ያስገቡ።");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const newBalance = await withdrawApi(Number(withdrawAmount));
      setMessage("✅ የብር ማውጣት ጥያቄዎ ተልኳል!");
      if (newBalance !== undefined) setBalance(newBalance);
      setWithdrawAmount("");
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || "ሊሳካ አልቻለም";
      setMessage(`❌ ስህተት: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  if (showHistory) {
    return (
      <div className="page-view" style={{ padding: "15px", textAlign: "center" }}>
        <h2 style={{ color: "#f39c12", marginBottom: "15px" }}>📜 Transaction History</h2>
        <p style={{ color: "#aaa" }}>የክፍያ ታሪክዎ በዚህ መልኩ ይታያል...</p>
      </div>
    );
  }

  return (
    <div className="page-view wallet-view" style={{ padding: "15px", maxWidth: "450px", margin: "0 auto" }}>
      
      {/* Header Title & Refresh */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
        <h2 style={{ color: "#fff", fontSize: "20px", margin: 0 }}>💳 Wallet & Transactions</h2>
        <button 
          onClick={() => window.location.reload()}
          style={{ background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", color: "#f39c12" }}
        >
          🔄
        </button>
      </div>

      {/* Phone Verified Bar */}
      <div style={{ 
        background: "#1a1a2e", 
        border: "1px solid #2a2a40", 
        borderRadius: "12px", 
        padding: "12px 15px", 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        marginBottom: "15px" 
      }}>
        <div style={{ color: "#fff", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>👤</span> +251948709148
        </div>
        <div style={{ background: "rgba(46, 204, 113, 0.15)", color: "#2ecc71", border: "1px solid #2ecc71", padding: "4px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "bold" }}>
          ✓ Verified
        </div>
      </div>

      {/* Balance Section Box */}
      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "14px", padding: "15px", marginBottom: "15px", textAlign: "center" }}>
        <div style={{ color: "#f39c12", fontSize: "14px", fontWeight: "bold", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>
          Balance
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <div style={{ flex: 1, background: "#12121e", border: "1px solid #333", borderRadius: "10px", padding: "12px" }}>
            <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "5px" }}>Main Wallet</div>
            <div style={{ color: "#fff", fontSize: "18px", fontWeight: "bold" }}>{balance} ETB</div>
          </div>
          <div style={{ flex: 1, background: "#12121e", border: "1px solid #333", borderRadius: "10px", padding: "12px" }}>
            <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "5px" }}>Play Wallet</div>
            <div style={{ color: "#2ecc71", fontSize: "18px", fontWeight: "bold" }}>0 ETB</div>
          </div>
        </div>
      </div>

      {/* Message Alert */}
      {message && (
        <div style={{ background: "#222", border: "1px solid #f39c12", color: "#fff", padding: "10px", borderRadius: "8px", marginBottom: "15px", fontSize: "13px", textAlign: "center" }}>
          {message}
        </div>
      )}

      {/* Deposit Box */}
      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "14px", padding: "15px", marginBottom: "15px" }}>
        <div style={{ color: "#2ecc71", fontSize: "15px", fontWeight: "bold", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
          📥 Deposit (በቴሌብር ብር መሞላት)
        </div>
        <ol style={{ color: "#bbb", fontSize: "12px", paddingLeft: "18px", margin: "0 0 12px 0", lineHeight: "1.5" }}>
          <li>የሚለውን የብር መጠን ይላኩ ወይም ያስገቡ</li>
          <li>የቴሌብር SMS መልእክቱን ሙሉ በሙሉ ኮፒ በማድረግ ከዚህ በታች ባለው ሳጥን ውስጥ አስገቡ</li>
        </ol>

        <form onSubmit={handleDeposit}>
          <div style={{ marginBottom: "10px" }}>
            <label style={{ display: "block", color: "#f39c12", fontSize: "12px", marginBottom: "5px" }}>የብር መጠን (ETB):</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="200"
              style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "10px", color: "#fff", fontSize: "14px", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", color: "#f39c12", fontSize: "12px", marginBottom: "5px" }}>የቴሌብር SMS መልእክት (Copy Paste):</label>
            <textarea
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              placeholder="ድረሰትን ሙሉ የቴሌብር SMS መልእክት እዚህ ጋር ድርሰ እና ዱ (Paste) ይድርጉ..."
              rows={3}
              style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "10px", color: "#fff", fontSize: "12px", boxSizing: "border-box", resize: "none" }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: "linear-gradient(135deg, #2ecc71, #27ae60)",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              padding: "12px",
              fontSize: "14px",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "0 4px 10px rgba(46, 204, 113, 0.3)"
            }}
          >
            {loading ? " በመላክ ላይ..." : "የተረጋገጠ ድርም ልክ (Submit Deposit)"}
          </button>
        </form>
      </div>

      {/* Withdraw Box */}
      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "14px", padding: "15px", marginBottom: "20px" }}>
        <div style={{ color: "#e74c3c", fontSize: "15px", fontWeight: "bold", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
          📤 Withdraw (ገንዘብ ማውጣት ፍርም)
        </div>

        <form onSubmit={handleWithdraw}>
          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", color: "#aaa", fontSize: "12px", marginBottom: "5px" }}>መጠን (ETB)</label>
            <input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="0"
              style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "10px", color: "#fff", fontSize: "14px", boxSizing: "border-box" }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: "linear-gradient(135deg, #e74c3c, #c0392b)",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              padding: "12px",
              fontSize: "14px",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "0 4px 10px rgba(231, 76, 60, 0.3)"
            }}
          >
            {loading ? "በማስኬድ ላይ..." : "የወጣ ድርም ልክ (Submit Withdraw)"}
          </button>
        </form>
      </div>

    </div>
  );
}

export default Wallet;