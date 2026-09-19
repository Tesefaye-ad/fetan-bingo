import { useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";

export default function CartelaSelection({ roomCode, balance, stake = 10, onConfirm, onCancel }) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [deadlineAt, setDeadlineAt] = useState(null); // 👈 አዲስ (state)
  const [error, setError] = useState("");
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [isWeekly, setIsWeekly] = useState(false);

  const triggeredRef = useRef(false);
  const fetchedRef = useRef(false);

  const isWeeklyRoom = roomCode === "ROOM50" || roomCode === "ROOM100";

  // ═══════════════════════════════════════════════════
  // Fetch initial state — ONCE
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      try {
        const res = await fetch(
          `${process.env.REACT_APP_API_URL}/api/game/rooms/${roomCode}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("bingo_token")}`,
            },
          }
        );
        const data = await res.json();

        if (data.takenCards) setTakenCards(data.takenCards);
        if (data.reservedCards) {
          setTakenCards((prev) => [...new Set([...prev, ...data.reservedCards])]);
        }

        if (data.isWeeklyGame || isWeeklyRoom) {
          setIsWeekly(true);
          setCountdown(null);
          setDeadlineAt(null);
        } else if (
          typeof data.remainingSeconds === "number" &&
          data.remainingSeconds > 0
        ) {
          // 👈 ወደ state አስቀምጥ (አዲስ deadline)
          setDeadlineAt(Date.now() + data.remainingSeconds * 1000);
          setCountdown(data.remainingSeconds);
          console.log(`[Cartela] Server remaining: ${data.remainingSeconds}s`);
        } else {
          // Default fallback
          setDeadlineAt(Date.now() + 50000);
          setCountdown(50);
        }
      } catch (e) {
        console.error("[Cartela] fetch error:", e);
        if (!isWeeklyRoom) {
          setDeadlineAt(Date.now() + 50000);
          setCountdown(50);
        }
      }
    })();

    fetch(`${process.env.REACT_APP_API_URL}/api/wallet/balance`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("bingo_token")}`,
      },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.balance !== undefined) setCurrentBalance(d.balance);
      })
      .catch(() => {});
  }, [roomCode, isWeeklyRoom]);

  // ═══════════════════════════════════════════════════
  // 👈 ቆጣሪ — deadlineAt ሲቀመጥ ብቻ ይጀምራል (state dep!)
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (isWeekly) return;
    if (!deadlineAt) return;

    console.log("[Cartela] Countdown effect started");

    const tick = () => {
      const rem = Math.max(
        0,
        Math.floor((deadlineAt - Date.now()) / 1000)
      );
      setCountdown(rem);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadlineAt, isWeekly]);

  // ═══════════════════════════════════════════════════
  // ሰዓቱ 0 ሲሆን ወደ ጨዋታው ሂድ
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (isWeekly) return;
    if (countdown === null || countdown > 0) return;
    if (triggeredRef.current) return;
    triggeredRef.current = true;

    console.log("[Cartela] Countdown 0 → moving to game");

    if (selectedCards.length === 0) {
      const takenSet = new Set(takenCards);
      const free = [];
      for (let i = 1; i <= 1000; i++) if (!takenSet.has(i)) free.push(i);
      if (free.length) {
        return onConfirm([free[Math.floor(Math.random() * free.length)]]);
      }
    }
    onConfirm(selectedCards);
  }, [countdown, selectedCards, takenCards, onConfirm, isWeekly]);

  // ═══════════════════════════════════════════════════
  // Socket events
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    const s = getSocket();
    const onSel = ({ cardId }) =>
      setTakenCards((p) => [...new Set([...p, cardId])]);
    const onDesel = ({ cardId }) =>
      setTakenCards((p) => p.filter((x) => x !== cardId));
    const onBal = ({ balance: b }) => setCurrentBalance(b);

    s.on("card_selected", onSel);
    s.on("card_deselected", onDesel);
    s.on("balance_update", onBal);
    return () => {
      s.off("card_selected", onSel);
      s.off("card_deselected", onDesel);
      s.off("balance_update", onBal);
    };
  }, []);

  const handleSelect = (id) => {
    if (takenCards.includes(id) && !selectedCards.includes(id)) {
      return setError(`ካርድ #${id} አስቀድሞ ተይዟል!`);
    }
    if (selectedCards.includes(id)) {
      getSocket().emit("deselect_card", { roomCode, cardId: id });
      setSelectedCards((p) => p.filter((x) => x !== id));
      setError("");
      return;
    }
    if (currentBalance < stake) {
      return setError(`❌ በቂ ባላንስ የለዎትም! (${stake} ETB)`);
    }
    getSocket().emit("select_card", { roomCode, cardId: id });
    setSelectedCards((p) => [...p, id]);
    setError("");
  };

  const confirmWeekly = () => {
    if (!selectedCards.length) return setError("❌ ቢያንስ አንድ ካርድ ይምረጡ!");
    onConfirm(selectedCards);
  };

  const numbers = Array.from({ length: 1000 }, (_, i) => i + 1);
  const total = selectedCards.length * stake;

  return (
    <div
      style={{
        padding: 10,
        maxWidth: 480,
        margin: "0 auto",
        color: "#fff",
        minHeight: "100vh",
        background: "#0f1420",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button
        onClick={onCancel}
        style={{
          alignSelf: "flex-start",
          background: "#1a1a2e",
          border: "1px solid #4c6ef5",
          color: "#fff",
          borderRadius: 10,
          padding: "10px 18px",
          cursor: "pointer",
          marginBottom: 10,
        }}
      >
        ← Back
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 5,
          background: "#1a1a2e",
          border: "1px solid #2a2a40",
          borderRadius: 10,
          padding: "10px 8px",
          marginBottom: 10,
        }}
      >
        <InfoCell label="Wallet" value={currentBalance} />
        <InfoCell label="Stake" value={stake} />
        <InfoCell label="Selected" value={selectedCards.length} />
        <InfoCell
          label={isWeekly ? "Draw" : "Time"}
          value={
            isWeekly
              ? roomCode === "ROOM50"
                ? "ቅዳሜ 12:00"
                : "ቅዳሜ 12:05"
              : countdown !== null
              ? `${countdown}s`
              : "…"
          }
          color={
            isWeekly
              ? "#f39c12"
              : countdown !== null && countdown <= 10
              ? "#e74c3c"
              : "#ffd43b"
          }
          small={isWeekly}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          background: "#1a1a2e",
          border: "1px solid #2a2a40",
          borderRadius: 10,
          padding: "8px 12px",
          marginBottom: 10,
          fontSize: 12,
        }}
      >
        <span>
          Selected: <b style={{ color: "#2ecc71" }}>{selectedCards.length}</b>
        </span>
        <span>
          Total: <b style={{ color: "#f39c12" }}>{total} ETB</b>
        </span>
      </div>

      {error && (
        <div
          style={{
            background: "#e74c3c",
            color: "#fff",
            padding: 6,
            borderRadius: 8,
            marginBottom: 8,
            fontSize: 11,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(8, 1fr)",
          gap: 5,
          marginBottom: 10,
          paddingRight: 5,
          alignContent: "start",
        }}
      >
        {numbers.map((n) => {
          const isTaken = takenCards.includes(n) && !selectedCards.includes(n);
          const isSelected = selectedCards.includes(n);
          return (
            <button
              key={n}
              onClick={() => handleSelect(n)}
              disabled={isTaken}
              style={{
                padding: "10px 0",
                borderRadius: 8,
                border: isSelected ? "2px solid #2ecc71" : "1px solid #333",
                background: isTaken ? "#c0392b" : isSelected ? "#2ecc71" : "#1b2233",
                color: "#fff",
                fontWeight: "bold",
                fontSize: 11,
                cursor: isTaken ? "not-allowed" : "pointer",
                opacity: isTaken ? 0.7 : 1,
              }}
            >
              {n}
            </button>
          );
        })}
      </div>

      {isWeekly ? (
        <>
          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #f39c12",
              borderRadius: 10,
              padding: 10,
              marginBottom: 10,
              textAlign: "center",
              fontSize: 11,
              color: "#f39c12",
            }}
          >
            🗓 ሳምንታዊ እጣ! ካርዶችዎን ይምረጡ። ጨዋታው ይጀመራል{" "}
            <b>{roomCode === "ROOM50" ? "ቅዳሜ 12:00" : "ቅዳሜ 12:05"}</b>
          </div>
          <button
            onClick={confirmWeekly}
            disabled={!selectedCards.length}
            style={{
              width: "100%",
              background: !selectedCards.length
                ? "#555"
                : "linear-gradient(135deg,#f39c12,#e67e22)",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: 14,
              fontSize: 14,
              fontWeight: "bold",
              cursor: !selectedCards.length ? "not-allowed" : "pointer",
              marginBottom: 10,
            }}
          >
            ✅ Confirm ({selectedCards.length} ካርዶች, {total} ETB)
          </button>
        </>
      ) : (
        <div
          style={{
            fontSize: 11,
            color: "#888",
            textAlign: "center",
            paddingBottom: 10,
          }}
        >
          ሰዓቱ ሲያልቅ በራስ-ሰር ወደ ጨዋታው ይገባል
        </div>
      )}
    </div>
  );
}

function InfoCell({ label, value, color = "#fff", small = false }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: "#aaa", fontSize: 10, marginBottom: 3 }}>{label}</div>
      <div
        style={{
          color,
          fontSize: small ? 11 : 14,
          fontWeight: "bold",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
    </div>
  );
}