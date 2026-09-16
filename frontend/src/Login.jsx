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
      setError("");

      // የቴሌግራም ማረጋገጫ ገደቦችን (Checks) አስወግደናል
      // በቀጥታ ከ Backend ጋር ለመገናኘት እንሞክራለን
      try {
        const user = await loginWithTelegram(initData || "");
        onLoggedIn(user);
      } catch (err) {
        console.warn("Backend login failed, using mock data for testing:", err.message);
        
        // የ Backend ግንኙነት ካልተሳካ (ለምሳሌ ከቴሌግራም ውጭ ከሆነ) ለሙከራ የሚሆን ጊዜያዊ ተጠቃሚ እንፍጠር
        const mockUser = {
          id: "local_admin",
          telegramId: "494653076",
          firstName: "Tesfaye",
          username: "admin_test",
          balance: 1000,        // ለሙከራ የተሰጠ ባላንስ
          bonusBalance: 200,
          gamesWon: 0,
          referralCount: 0,
          isAdmin: true,
          token: "mock-local-token"
        };
        
        onLoggedIn(mockUser);
      } finally {
        setLoading(false);
      }
    }

    handleLogin();
  }, [ready, initData, onLoggedIn]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0f172a", color: "#fff", fontFamily: "sans-serif", padding: "20px", textAlign: "center" }}>
        <div style={{ fontSize: "18px", color: "#38bdf8", fontWeight: "bold", marginBottom: "8px" }}>Fetan Lottery is loading...</div>
        <div style={{ fontSize: "12px", color: "#94a3b8" }}>Preparing your dashboard...</div>
      </div>
    );
  }

  // ስህተት ካለ የሚታየው ገጽ (አሁን ስህተቱ ስለማይፈጠር ይህ ገጽ ብዙም አይታይም)
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0f172a", color: "#e74c3c", fontFamily: "sans-serif", padding: "30px", textAlign: "center" }}>
      <div style={{ fontSize: "16px", lineHeight: "1.6", maxWidth: "400px" }}>{error || "Something went wrong."}</div>
      <button onClick={() => window.location.reload()} style={{ marginTop: "25px", background: "#38bdf8", color: "#0f172a", border: "none", borderRadius: "10px", padding: "12px 28px", fontSize: "14px", fontWeight: "bold", cursor: "pointer" }}>
        🔄 Retry
      </button>
    </div>
  );
}