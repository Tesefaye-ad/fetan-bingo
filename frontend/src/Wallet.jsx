import React, { useState, useEffect } from "react";
import { initiateDeposit, withdraw as withdrawApi, transfer as transferApi, getWalletHistory } from "./api";

function Wallet({ balance, setBalance, showHistory, compact }) {
  const [amount, setAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [transferId, setTransferId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (showHistory) {
      getWalletHistory().then(setHistory).catch(() => {});
    }
  }, [showHistory]);

  const handleDeposit = async (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) { setMessage("እባክዎ ትክክለኛ የብር መጠን ያስገቡ።"); return; }
    setLoading(true); setMessage("");
    try {
      const data = await initiateDeposit(Number(amount));
      setMessage(`✅ ${data.message || "የዲፖዚት ጥያቄዎ ተልኳል!"}\nReference: ${data.reference}`);
      setAmount("");
    } catch (err) {
      setMessage(`❌ ${err?.response?.data?.error || err.message}`);
    } finally { setLoading(false); }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    if (!withdrawAmount || Number(withdrawAmount) <= 0) { setMessage("እባክዎ ትክክለኛ መጠን ያስገቡ።"); return; }
    setLoading(true); setMessage("");
    try {
      const newBalance = await withdrawApi(Number(withdrawAmount));
      setMessage("✅ የብር ማውጣት ጥያቄዎ ተልኳል!");
      if (newBalance !== undefined) setBalance(newBalance);
      setWithdrawAmount("");
    } catch (err) {
      setMessage(`❌ ${err?.response?.data?.error || err.message}`);
    } finally { setLoading(false); }
  };

  const handleTransfer = async (e) => {
    e.preventDefault();
    if (!transferId || !transferAmount || Number(transferAmount) <= 0) {
      setMessage("እባክዎ የተቀባይ ID እና ትክክለኛ መጠን ያስገቡ።"); return;
    }
    setLoading(true); setMessage("");
    try {
      const newBalance = await transferApi(transferId, Number(transferAmount));
      setMessage("✅ ገንዘቡ በተሳካ ሁኔታ ተላልፏል!");
      if (newBalance !== undefined) setBalance(newBalance);
      setTransferId(""); setTransferAmount("");
    } catch (err) {
      setMessage(`❌ ${err?.response?.data?.error || err.message}`);
    } finally { setLoading(false); }
  };

  if (showHistory) {
    return (
      <div style={{ padding: "15px", maxWidth: "450px", margin: "0 auto" }}>
        <h2 style={{ color: "#f39c12", marginBottom: "15px", textAlign: "center" }}>📜 Transaction History</h2>
        {history.length === 0 ? (
          <p style={{ color: "#aaa", textAlign: "center" }}>No transactions yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {history.map((tx) => (
              <li key={tx._id} style={{ display: "flex", justifyContent: "space-between", background: "#1b2233", borderRadius: "8px", padding: "10px 12px", marginBottom: "6px", fontSize: "13px", color: "#fff" }}>
                <div>
                  <div style={{ fontWeight: "bold", textTransform: "capitalize" }}>{tx.type.replace("_", " ")}</div>
                  <div style={{ color: "#888", fontSize: "11px" }}>{new Date(tx.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: tx.type === "withdrawal" || tx.type === "entry_fee" || tx.type === "transfer_out" ? "#e74c3c" : "#2ecc71", fontWeight: "bold" }}>
                    {tx.type === "withdrawal" || tx.type === "entry_fee" || tx.type === "transfer_out" ? "-" : "+"}{tx.amount} ETB
                  </div>
                  <div style={{ color: "#888", fontSize: "11px" }}>{tx.status}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (compact) {
    return (
      <div style={{ background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "12px", padding: "12px", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: "#aaa", fontSize: "11px" }}>💳 Balance</div>
          <div style={{ color: "#fff", fontSize: "18px", fontWeight: "bold" }}>{balance} ETB</div>
        </div>
        <div style={{ color: "#2ecc71", fontSize: "12px" }}>✓ Verified</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "15px", maxWidth: "450px", margin: "0 auto" }}>
      <h2 style={{ color: "#fff", fontSize: "20px", marginBottom: "15px" }}>💳 Wallet</h2>

      <div style={{ background: "#1a1a2e", border: "1px solid #f39c12", borderRadius: "14px", padding: "15px", marginBottom: "15px", textAlign: "center" }}>
        <div style={{ color: "#f39c12", fontSize: "12px", marginBottom: "8px" }}>MAIN BALANCE</div>
        <div style={{ color: "#fff", fontSize: "28px", fontWeight: "bold" }}>{balance} ETB</div>
      </div>

      {message && (
        <div style={{ background: "#222", border: "1px solid #f39c12", color: "#fff", padding: "10px", borderRadius: "8px", marginBottom: "15px", fontSize: "12px", textAlign: "center", whiteSpace: "pre-line" }}>
          {message}
        </div>
      )}

      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "14px", padding: "15px", marginBottom: "15px" }}>
        <div style={{ color: "#2ecc71", fontSize: "14px", fontWeight: "bold", marginBottom: "10px" }}>📥 Deposit</div>
        <form onSubmit={handleDeposit}>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (ETB)" style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "10px", color: "#fff", fontSize: "14px", boxSizing: "border-box", marginBottom: "10px" }} />
          <button type="submit" disabled={loading} style={{ width: "100%", background: "#2ecc71", color: "#fff", border: "none", borderRadius: "10px", padding: "12px", fontWeight: "bold", cursor: "pointer" }}>
            {loading ? "..." : "Submit Deposit"}
          </button>
        </form>
      </div>

      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "14px", padding: "15px", marginBottom: "15px" }}>
        <div style={{ color: "#e74c3c", fontSize: "14px", fontWeight: "bold", marginBottom: "10px" }}>📤 Withdraw</div>
        <form onSubmit={handleWithdraw}>
          <input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="Amount (ETB)" style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "10px", color: "#fff", fontSize: "14px", boxSizing: "border-box", marginBottom: "10px" }} />
          <button type="submit" disabled={loading} style={{ width: "100%", background: "#e74c3c", color: "#fff", border: "none", borderRadius: "10px", padding: "12px", fontWeight: "bold", cursor: "pointer" }}>
            {loading ? "..." : "Submit Withdraw"}
          </button>
        </form>
      </div>

      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: "14px", padding: "15px", marginBottom: "15px" }}>
        <div style={{ color: "#f39c12", fontSize: "14px", fontWeight: "bold", marginBottom: "10px" }}>💸 Transfer</div>
        <form onSubmit={handleTransfer}>
          <input type="text" value={transferId} onChange={(e) => setTransferId(e.target.value)} placeholder="Recipient Telegram ID" style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "10px", color: "#fff", fontSize: "14px", boxSizing: "border-box", marginBottom: "10px" }} />
          <input type="number" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} placeholder="Amount (ETB)" style={{ width: "100%", background: "#12121e", border: "1px solid #333", borderRadius: "8px", padding: "10px", color: "#fff", fontSize: "14px", boxSizing: "border-box", marginBottom: "10px" }} />
          <button type="submit" disabled={loading} style={{ width: "100%", background: "#f39c12", color: "#111", border: "none", borderRadius: "10px", padding: "12px", fontWeight: "bold", cursor: "pointer" }}>
            {loading ? "..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Wallet;