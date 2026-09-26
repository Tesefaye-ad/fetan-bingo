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
      setMessage(
        `✅ የዲፖዚት ጥያቄዎ ተልኳል!\n\n📞 ወደ Telebirr ይላኩ: ${
          data.telebirrPhone
        }\n💰 መጠን: ${data.amount} ETB\n🔖 Reference: ${
          data.reference
        }\n\nከተከፈሉ በኋላ SMS ቅዳ በ Bot ይላኩ።`
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
      setMessage("✅ የብር ማውጣት ጥያቄዎ ተልኳል! በ 24 ሰዓት ውስጥ ይስተናገዳል።");
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
      const newBalance = await transferApi(
        transferId,
        Number(transferAmount)
      );
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

  // ═══════════════════════════════════════════════
  // HISTORY VIEW
  // ═══════════════════════════════════════════════
  if (showHistory) {
    return (
      <div
        style={{
          padding: "15px",
          maxWidth: "450px",
          margin: "0 auto",
          minHeight: "100vh",
          background: "linear-gradient(180deg, #0a0a14 0%, #150a2e 100%)",
        }}
      >
        <h2
          style={{
            color: "#f39c12",
            marginBottom: 18,
            textAlign: "center",
            fontSize: 20,
            fontWeight: "900",
            letterSpacing: 1,
            background: "linear-gradient(135deg, #f39c12, #ffd43b, #f39c12)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          📜 TRANSACTION HISTORY
        </h2>

        {history.length === 0 ? (
          <EmptyHistory />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {history.map((tx) => {
              const isOut = [
                "withdrawal",
                "entry_fee",
                "transfer_out",
              ].includes(tx.type);
              const typeIcon = {
                deposit: "📥",
                withdrawal: "📤",
                entry_fee: "🎯",
                prize: "🏆",
                refund: "↩️",
                transfer_in: "📩",
                transfer_out: "📨",
              }[tx.type] || "💰";

              return (
                <li
                  key={tx._id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background:
                      "linear-gradient(135deg, rgba(26,26,46,0.9), rgba(15,20,32,0.9))",
                    border: `1px solid ${
                      tx.status === "completed"
                        ? isOut
                          ? "rgba(231,76,60,0.3)"
                          : "rgba(46,204,113,0.3)"
                        : tx.status === "pending"
                        ? "rgba(243,156,18,0.4)"
                        : "rgba(42,42,64,0.6)"
                    }`,
                    borderRadius: 12,
                    padding: "12px 14px",
                    marginBottom: 8,
                    fontSize: 13,
                    color: "#fff",
                    animation: "fadeInUp 0.3s ease-out",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: isOut
                          ? "rgba(231,76,60,0.15)"
                          : "rgba(46,204,113,0.15)",
                        border: `1px solid ${
                          isOut
                            ? "rgba(231,76,60,0.4)"
                            : "rgba(46,204,113,0.4)"
                        }`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                      }}
                    >
                      {typeIcon}
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
                        color: isOut ? "#e74c3c" : "#2ecc71",
                        fontWeight: "900",
                        fontSize: 14,
                        textShadow: isOut
                          ? "0 0 10px rgba(231,76,60,0.5)"
                          : "0 0 10px rgba(46,204,113,0.5)",
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
                            : "#666",
                        fontSize: 9,
                        fontWeight: "700",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        marginTop: 2,
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

  // ═══════════════════════════════════════════════
  // MAIN VIEW
  // ═══════════════════════════════════════════════
  return (
    <div
      style={{
        padding: "15px",
        maxWidth: "450px",
        margin: "0 auto",
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0a0a14 0%, #150a2e 100%)",
      }}
    >
      {/* 💳 Balance Card — Beautiful */}
      <div
        style={{
          background:
            "linear-gradient(135deg, #f39c12 0%, #e67e22 50%, #d35400 100%)",
          borderRadius: 20,
          padding: "24px 22px",
          marginBottom: 20,
          position: "relative",
          overflow: "hidden",
          boxShadow:
            "0 12px 40px rgba(243,156,18,0.4), inset 0 1px 0 rgba(255,255,255,0.3)",
        }}
      >
        {/* Decorative circles */}
        <div
          style={{
            position: "absolute",
            top: -30,
            right: -30,
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.1)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -20,
            left: -20,
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.08)",
          }}
        />

        <div style={{ position: "relative", zIndex: 1 }}>
          <div
            style={{
              color: "rgba(255,255,255,0.85)",
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 2,
              marginBottom: 6,
            }}
          >
            💰 MAIN BALANCE
          </div>
          <div
            style={{
              color: "#fff",
              fontSize: 38,
              fontWeight: "900",
              letterSpacing: -1,
              textShadow: "0 2px 10px rgba(0,0,0,0.2)",
              display: "flex",
              alignItems: "baseline",
              gap: 6,
            }}
          >
            {balance}
            <span
              style={{
                fontSize: 16,
                fontWeight: "700",
                opacity: 0.9,
              }}
            >
              ETB
            </span>
          </div>
        </div>
      </div>

      {message && (
        <div
          style={{
            background: "rgba(26,26,46,0.9)",
            border: "1px solid rgba(243,156,18,0.4)",
            color: "#fff",
            padding: 12,
            borderRadius: 12,
            marginBottom: 16,
            fontSize: 12,
            textAlign: "center",
            whiteSpace: "pre-line",
            backdropFilter: "blur(10px)",
            animation: "fadeInUp 0.3s ease-out",
          }}
        >
          {message}
        </div>
      )}

      {/* 📥 Deposit */}
      <WalletCard
        icon="📥"
        title="DEPOSIT"
        subtitle="Add money to your wallet"
        color="#2ecc71"
      >
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
            style={{
              ...btnStyle,
              background: "linear-gradient(135deg, #2ecc71, #27ae60)",
              boxShadow: "0 6px 20px rgba(46,204,113,0.4)",
            }}
          >
            {loading ? "..." : "💰 Submit Deposit"}
          </button>
        </form>
      </WalletCard>

      {/* 📤 Withdraw */}
      <WalletCard
        icon="📤"
        title="WITHDRAW"
        subtitle="Cash out to your Telebirr"
        color="#e74c3c"
      >
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
            style={{
              ...btnStyle,
              background: "linear-gradient(135deg, #e74c3c, #c0392b)",
              boxShadow: "0 6px 20px rgba(231,76,60,0.4)",
            }}
          >
            {loading ? "..." : "📤 Submit Withdraw"}
          </button>
        </form>
      </WalletCard>

      {/* 💸 Transfer */}
      <WalletCard
        icon="💸"
        title="TRANSFER"
        subtitle="Send money to another player"
        color="#f39c12"
      >
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
            style={{
              ...btnStyle,
              background: "linear-gradient(135deg, #f39c12, #e67e22)",
              color: "#111",
              boxShadow: "0 6px 20px rgba(243,156,18,0.4)",
            }}
          >
            {loading ? "..." : "💸 Send Money"}
          </button>
        </form>
      </WalletCard>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function WalletCard({ icon, title, subtitle, color, children }) {
  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, rgba(26,26,46,0.7), rgba(15,20,32,0.9))",
        border: `1px solid ${color}44`,
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
        boxShadow: `0 4px 20px ${color}22, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: `${color}22`,
            border: `1px solid ${color}66`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          {icon}
        </div>
        <div>
          <div
            style={{
              color,
              fontSize: 13,
              fontWeight: "900",
              letterSpacing: 1,
              textShadow: `0 0 10px ${color}66`,
            }}
          >
            {title}
          </div>
          <div
            style={{
              color: "#666",
              fontSize: 10,
              marginTop: 1,
              fontWeight: "600",
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyHistory() {
  return (
    <div
      style={{
        textAlign: "center",
        padding: 60,
        color: "#666",
        border: "1px dashed rgba(42,42,64,0.8)",
        borderRadius: 14,
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 50, marginBottom: 12, opacity: 0.5 }}>📭</div>
      <div style={{ fontWeight: "700" }}>No transactions yet</div>
      <div style={{ fontSize: 11, marginTop: 4 }}>
        Your history will appear here
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "rgba(0,0,0,0.4)",
  border: "1px solid rgba(42,42,64,0.8)",
  borderRadius: 10,
  padding: 12,
  color: "#fff",
  fontSize: 14,
  boxSizing: "border-box",
  marginBottom: 10,
  outline: "none",
  fontFamily: "inherit",
  fontWeight: "600",
};

const btnStyle = {
  width: "100%",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: 14,
  fontWeight: "900",
  cursor: "pointer",
  fontSize: 14,
  letterSpacing: 0.5,
  fontFamily: "inherit",
  transition: "transform 0.15s ease",
};

export default Wallet;