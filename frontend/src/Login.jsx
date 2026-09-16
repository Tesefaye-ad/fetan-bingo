import React, { useEffect, useState } from "react";
import { useTelegram } from "./useTelegram";
import { loginWithTelegram } from "./api";

export default function Login({ onLoggedIn }) {
  const { initData, isTelegram, ready } = useTelegram();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;

    async function handleLogin() {
      if (!isTelegram) {
        setError("This app must be opened from inside Telegram (via your bot's menu button).");
        setLoading(false);
        return;
      }
      if (!initData) {
        setError("Telegram initData is missing. Close and reopen the app from your bot.");
        setLoading(false);
        return;
      }
      try {
        const user = await loginWithTelegram(initData);
        onLoggedIn(user);
      } catch (err) {
        const msg = err?.response?.data?.error || err?.message || "Login failed. Please reopen the app from Telegram.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }

    handleLogin();
  }, [ready, isTelegram, initData, onLoggedIn]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0f172a", color: "#fff", fontFamily: "sans-serif", padding: "20px", textAlign: "center" }}>
        <div style={{ fontSize: "18px", color: "#38bdf8", fontWeight: "bold", marginBottom: "8px" }}>Fetan Lottery is loading...</div>
        <div style={{ fontSize: "12px", color: "#94a3b8" }}>Connecting to Telegram...</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0f172a", color: "#e74c3c", fontFamily: "sans-serif", padding: "30px", textAlign: "center" }}>
      <div style={{ fontSize: "16px", lineHeight: "1.6", maxWidth: "400px" }}>{error}</div>
      <button onClick={() => window.location.reload()} style={{ marginTop: "25px", background: "#38bdf8", color: "#0f172a", border: "none", borderRadius: "10px", padding: "12px 28px", fontSize: "14px", fontWeight: "bold", cursor: "pointer" }}>
        🔄 Retry
      </button>
    </div>
  );
}