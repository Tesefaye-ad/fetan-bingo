import React, { useState, useEffect } from "react";
import {
  initiateDeposit,
  withdraw as withdrawApi,
  transfer as transferApi,
  getWalletHistory,
} from "./api";

function Wallet({ balance, setBalance, showHistory }) {
  const [amount, setAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPhone, setWithdrawPhone] = useState("");
  const [transferId, setTransferId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  // ❌ depositInfo ተሰርዟል (አያስፈልግም)

  useEffect(() => {
    if (showHistory) {
      getWalletHistory()
        .then(setHistory)
        .catch(() => {});
    }
  }, [showHistory]);

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
      // ❌ setDepositInfo(data) ተሰርዟል
      setMessage(
        `✅ የዲፖዚት ጥያቄዎ ተልኳል!\n\n📞 ወደ Telebirr ይላኩ: ${data.telebirrPhone}\n💰 መጠን: ${data.amount} ETB\n🔖 Reference: ${data.reference}\n\nከተከፈሉ በኋላ SMS ቅዳ በ Bot ይላኩ።`
      );
      setAmount("");
    } catch (err) {
      setMessage(`❌ ${err?.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    if (!withdrawAmount || Number(withdrawAmount) <= 0) {
      setMessage("እባክዎ ትክክለኛ መጠን ያስገቡ።");
      return;
    }
    if (!withdrawPhone) {
      setMessage("እባክዎ የስልክ ቁጥርዎን ያስገቡ።");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const newBalance = await withdrawApi(
        Number(withdrawAmount),
        withdrawPhone,
        "telebirr"
      );
      setMessage(
        "✅ የብር ማውጣት ጥያቄዎ ተልኳል! በ 24 ሰዓት ውስጥ ይስተናገዳል።"
      );
      if (newBalance !== undefined) setBalance(newBalance);
      setWithdrawAmount("");
      setWithdrawPhone("");
    } catch (err) {
      setMessage(`❌ ${err?.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTransfer = async (e) => {
    e.preventDefault();
    if (!transferId || !transferAmount || Number(transferAmount) <= 0) {
      setMessage("እባክዎ የተቀባይ ID እና ትክክለኛ መጠን ያስገቡ።");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const newBalance = await transferApi(transferId, Number(transferAmount));
      setMessage("✅ ገንዘቡ በተሳካ ሁኔታ ተላልፏል!");
      if (newBalance !== undefined) setBalance(newBalance);
      setTransferId("");
      setTransferAmount("");
    } catch (err) {
      setMessage(`❌ ${err?.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (showHistory) {
    return (
      <div style={{ padding: 15, maxWidth: 450, margin: "0 auto" }}>
        <h2
          style={{
            color: "#f39c12",
            marginBottom: 15,
            textAlign: "center",
          }}
        >
          📜 Transaction History
        </h2>
        {history.length === 0 ? (
          <p style={{ color: "#aaa", textAlign: "center" }}>
            No transactions yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {history.map((tx) => {
              const isOut = [
                "withdrawal",
                "entry_fee",
                "transfer_out",
              ].includes(tx.type);
              return (
                <li
                  key={tx._id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    background: "#1b2233",
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 6,
                    fontSize: 13,
                    color: "#fff",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: "bold",
                        textTransform: "capitalize",
                      }}
                    >
                      {tx.type.replace("_", " ")}
                    </div>
                    <div style={{ color: "#888", fontSize: 11 }}>
                      {new Date(tx.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        color: isOut ? "#e74c3c" : "#2ecc71",
                        fontWeight: "bold",
                      }}
                    >
                      {isOut ? "-" : "+"}
                      {tx.amount} ETB
                    </div>
                    <div
                      style={{
                        color:
                          tx.status === "pending"
                            ? "#f39c12"
                            : tx.status === "failed"
                            ? "#e74c3c"
                            : "#888",
                        fontSize: 11,
                      }}
                    >
                      {tx.status}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 15, maxWidth: 450, margin: "0 auto" }}>
      <div
        style={{
          background: "#1a1a2e",
          border: "1px solid #f39c12",
          borderRadius: 14,
          padding: 15,
          marginBottom: 15,
          textAlign: "center",
        }}
      >
        <div style={{ color: "#f39c12", fontSize: 12, marginBottom: 8 }}>
          MAIN BALANCE
        </div>
        <div style={{ color: "#fff", fontSize: 28, fontWeight: "bold" }}>
          {balance} ETB
        </div>
      </div>

      {message && (
        <div
          style={{
            background: "#222",
            border: "1px solid #f39c12",
            color: "#fff",
            padding: 10,
            borderRadius: 8,
            marginBottom: 15,
            fontSize: 12,
            textAlign: "center",
            whiteSpace: "pre-line",
          }}
        >
          {message}
        </div>
      )}

      {/* Deposit */}
      <div
        style={{
          background: "#1a1a2e",
          border: "1px solid #2a2a40",
          borderRadius: 14,
          padding: 15,
          marginBottom: 15,
        }}
      >
        <div
          style={{
            color: "#2ecc71",
            fontSize: 14,
            fontWeight: "bold",
            marginBottom: 10,
          }}
        >
          📥 Deposit
        </div>
        <form onSubmit={handleDeposit}>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (min 20 ETB)"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ ...btnStyle, background: "#2ecc71" }}
          >
            {loading ? "..." : "Submit Deposit"}
          </button>
        </form>
      </div>

      {/* Withdraw */}
      <div
        style={{
          background: "#1a1a2e",
          border: "1px solid #2a2a40",
          borderRadius: 14,
          padding: 15,
          marginBottom: 15,
        }}
      >
        <div
          style={{
            color: "#e74c3c",
            fontSize: 14,
            fontWeight: "bold",
            marginBottom: 10,
          }}
        >
          📤 Withdraw
        </div>
        <form onSubmit={handleWithdraw}>
          <input
            type="text"
            value={withdrawPhone}
            onChange={(e) => setWithdrawPhone(e.target.value)}
            placeholder="Telebirr Phone (09xxxxxxxx)"
            style={inputStyle}
          />
          <input
            type="number"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="Amount (min 50 ETB)"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ ...btnStyle, background: "#e74c3c" }}
          >
            {loading ? "..." : "Submit Withdraw"}
          </button>
        </form>
      </div>

      {/* Transfer */}
      <div
        style={{
          background: "#1a1a2e",
          border: "1px solid #2a2a40",
          borderRadius: 14,
          padding: 15,
          marginBottom: 15,
        }}
      >
        <div
          style={{
            color: "#f39c12",
            fontSize: 14,
            fontWeight: "bold",
            marginBottom: 10,
          }}
        >
          💸 Transfer to User
        </div>
        <form onSubmit={handleTransfer}>
          <input
            type="text"
            value={transferId}
            onChange={(e) => setTransferId(e.target.value)}
            placeholder="Recipient Telegram ID"
            style={inputStyle}
          />
          <input
            type="number"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            placeholder="Amount (ETB)"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ ...btnStyle, background: "#f39c12", color: "#111" }}
          >
            {loading ? "..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "#12121e",
  border: "1px solid #333",
  borderRadius: 8,
  padding: 10,
  color: "#fff",
  fontSize: 14,
  boxSizing: "border-box",
  marginBottom: 10,
};

const btnStyle = {
  width: "100%",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: 12,
  fontWeight: "bold",
  cursor: "pointer",
};

export default Wallet;