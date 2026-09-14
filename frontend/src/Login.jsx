import React, { useEffect, useState } from "react";
import { useTelegram } from "./useTelegram";
import { loginWithTelegram } from "./api";

export default function Login({ onLoggedIn }) {
  const { initData, isTelegram } = useTelegram();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function doLogin() {
      // 💻 ኮምፒውተር ላይ (Localhost) ሲከፈት ቴሌግራም ባይኖርም እንኳን እንዲሰራ ማረጋገጫ
      const isLocalhost = 
        window.location.hostname === "localhost" || 
        window.location.hostname === "127.0.0.1";

      if (!initData && !isLocalhost) {
        setError(
          "This app must be opened from inside Telegram (via your bot's menu button)."
        );
        setLoading(false);
        return;
      }

      try {
        let user;
        if (isLocalhost && !initData) {
          // 🧪 በብሮውዘር (Local) ሲሞክሩ እንደ አድሚን ሆኖ እንዲገባ የሚረዳ ሞክ ዩዘር (Mock User)
          user = {
            telegramId: "494653076", // 👈 የእርስዎ የአድሚን ID
            firstName: "Tesfaye",
            username: "admin_test",
            balance: 1000,
            bonusBalance: 200,
            isAdmin: true,
            role: "admin",
            token: "mock-local-token"
          };
        } else {
          // 📱 ቴሌግራም ውስጥ ሲከፈት በመደበኛ ሁኔታ ከባክኤንድ ጋር ይጣራል።
          user = await loginWithTelegram(initData);
        }
        
        onLoggedIn(user);
      } catch (err) {
        setError("Login failed. Please reopen the app from Telegram.");
      } finally {
        setLoading(false);
      }
    }
    doLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initData]);

  if (loading) {
    return <div className="center-screen">Signing you in…</div>;
  }

  if (error) {
    return (
      <div className="center-screen" style={{ textAlign: "center", color: "#fff", padding: "20px" }}>
        <p style={{ color: "#e74c3c", fontSize: "16px", marginBottom: "10px" }}>{error}</p>
        {!isTelegram && (
          <p className="hint" style={{ color: "#aaa", fontSize: "12px" }}>
            (Not detected as a Telegram WebApp environment)
          </p>
        )}
      </div>
    );
  }

  return null;
}