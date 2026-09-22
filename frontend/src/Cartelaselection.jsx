import { useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

export default function CartelaSelection({
  roomCode,
  balance,
  stake = 10,
  onConfirm,
  onCancel,
}) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [takenCards, setTakenCards] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [deadlineAt, setDeadlineAt] = useState(null);
  const [error, setError] = useState("");
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [isWeekly, setIsWeekly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const triggeredRef = useRef(false);
  const fetchedRef = useRef(false);
  const confirmLockRef = useRef(false);

  const isWeeklyRoom = roomCode === "ROOM50" || roomCode === "ROOM100";

  // ═══════════════════════════════════════════════════
  // ክፍል ሲቀየር ሁሉንም አጽዳ
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    triggeredRef.current = false;
    fetchedRef.current = false;
    confirmLockRef.current = false;
    setDeadlineAt(null);
    setCountdown(null);
    setSelectedCards([]);
    setTakenCards([]);
    setError("");
    setIsLoading(true);
    setFetchFailed(false);
  }, [roomCode]);

  // ═══════════════════════════════════════════════════
  // Fetch initial state — ONCE per room (ወይም retry ሲደረግ)
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        const token = localStorage.getItem("bingo_token");
        const res = await fetch(`${API_BASE_URL}/api/game/rooms/${roomCode}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        if (cancelled) return;

        console.log("[Cartela] Server response:", {
          remaining: data.remainingSeconds,
          endsAt: data.selectionEndsAt,
          serverTime: data.serverTime,
          weekly: data.isWeeklyGame,
        });

        // Taken cards (players + reserved)
        if (data.takenCards) setTakenCards(data.takenCards);
        if (data.reservedCards) {
          setTakenCards((prev) => [...new Set([...prev, ...data.reservedCards])]);
        }

        // Weekly rooms — no countdown
        if (data.isWeeklyGame || isWeeklyRoom) {
          setIsWeekly(true);
          setCountdown(null);
          setDeadlineAt(null);
          setIsLoading(false);
          return;
        }

        // ═══════════════════════════════════════════
        // ዋናው የሰዓት ስሌት
        // ═══════════════════════════════════════════
        let remaining = 0;
        let localDeadline = null;

        if (data.selectionEndsAt && data.serverTime) {
          const serverDeadline = new Date(data.selectionEndsAt).getTime();
          const serverNow = new Date(data.serverTime).getTime();

          if (Number.isFinite(serverDeadline) && Number.isFinite(serverNow)) {
            const clockOffset = serverNow - Date.now();
            localDeadline = serverDeadline - clockOffset;
            remaining = Math.max(
              0,
              Math.floor((localDeadline - Date.now()) / 1000)
            );
          }
        }

        // Fallback — serverTime ካልተላከ በ remainingSeconds ብቻ ተጠቀም
        if (localDeadline === null && typeof data.remainingSeconds === "number") {
          remaining = Math.max(0, data.remainingSeconds);
          if (remaining > 0) {
            localDeadline = Date.now() + remaining * 1000;
          }
        }

        if (localDeadline !== null) {
          setDeadlineAt(localDeadline);
          setCountdown(remaining);
        } else if (remaining === 0) {
          setCountdown(0);
        }

        setIsLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("[Cartela] fetch error:", e);
        setFetchFailed(true);
        setIsLoading(false);
      }
    })();

    // Fetch balance separately
    (async () => {
      try {
        const token = localStorage.getItem("bingo_token");
        const r = await fetch(`${API_BASE_URL}/api/wallet/balance`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        if (!cancelled && d.balance !== undefined) setCurrentBalance(d.balance);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomCode, isWeeklyRoom, retryKey]);

  // ═══════════════════════════════════════════════════
  // ቆጣሪ
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (isWeekly) return;
    if (!deadlineAt) return;

    const tick = () => {
      const rem = Math.max(0, Math.floor((deadlineAt - Date.now()) / 1000));
      setCountdown(rem);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadlineAt, isWeekly]);

  // ═══════════════════════════════════════════════════
  // ሰዓቱ 0 ሲሆን → ወደ ጨዋታ
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (isWeekly) return;
    if (countdown === null || countdown > 0) return;
    if (triggeredRef.current || confirmLockRef.current) return;

    triggeredRef.current = true;
    confirmLockRef.current = true;

    console.log("[Cartela] Countdown 0 → moving to game");

    // ምንም ካርድ ካልተመረጠ — ነፃ ካርድ ምረጥ
    if (selectedCards.length === 0) {
      const takenSet = new Set(takenCards);
      const free = [];
      for (let i = 1; i <= 1000; i++) if (!takenSet.has(i)) free.push(i);
      if (free.length) {
        // 👈 3 ካርዶች ምረጥ — አንዱ ከተያዘ ሌላው ይሞክራል
        const shuffled = [...free].sort(() => Math.random() - 0.5);
        const picks = shuffled.slice(0, Math.min(3, shuffled.length));
        return onConfirm(picks);
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

  // ═══════════════════════════════════════════════════
  // Handlers
  // ═══════════════════════════════════════════════════
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
    if (confirmLockRef.current) return;
    if (!selectedCards.length) return setError("❌ ቢያንስ አንድ ካርድ ይምረጡ!");
    confirmLockRef.current = true;
    onConfirm(selectedCards);
  };

  const retryFetch = () => {
    fetchedRef.current = false;
    confirmLockRef.current = false;
    triggeredRef.current = false;
    setFetchFailed(false);
    setIsLoading(true);
    setError("");
    setSelectedCards([]);
    setTakenCards([]);
    setRetryKey((k) => k + 1);
  };

  const numbers = Array.from({ length: 1000 }, (_, i) => i + 1);
  const total = selectedCards.length * stake;

  // ═══════════════════════════════════════════════════
  // Loading state
  // ═══════════════════════════════════════════════════
  if (isLoading) {
    return (
      <div
        style={{
          padding: 20,
          maxWidth: 480,
          margin: "0 auto",
          color: "#fff",
          minHeight: "100vh",
          background: "#0f1420",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 15 }}>🎴</div>
        <div style={{ color: "#f39c12", fontSize: 14 }}>
          ካርቴላዎችን በመጫን ላይ...
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════
  // Fetch failed state
  // ═══════════════════════════════════════════════════
  if (fetchFailed) {
    return (
      <div
        style={{
          padding: 20,
          maxWidth: 480,
          margin: "0 auto",
          color: "#fff",
          minHeight: "100vh",
          background: "#0f1420",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 15 }}>⚠️</div>
        <div style={{ color: "#e74c3c", fontSize: 14, marginBottom: 15 }}>
          ከሰርቨር ጋር መገናኘት አልተቻለም
        </div>
        <button
          onClick={retryFetch}
          style={{
            background: "#f39c12",
            color: "#111",
            border: "none",
            borderRadius: 10,
            padding: "12px 30px",
            fontWeight: "bold",
            fontSize: 14,
            cursor: "pointer",
            marginBottom: 10,
          }}
        >
          🔄 እንደገና ሞክር
        </button>
        <button
          onClick={onCancel}
          style={{
            background: "transparent",
            color: "#888",
            border: "1px solid #333",
            borderRadius: 10,
            padding: "10px 20px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ← ተመለስ
        </button>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════
  // Main render
  // ═══════════════════════════════════════════════════
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

      {/* Info Grid */}
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

      {/* Totals */}
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

      {/* Error */}
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

      {/* Numbers Grid */}
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
                background: isTaken
                  ? "#c0392b"
                  : isSelected
                  ? "#2ecc71"
                  : "#1b2233",
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

      {/* Weekly — Confirm button */}
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
      <div style={{ color: "#aaa", fontSize: 10, marginBottom: 3 }}>
        {label}
      </div>
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