import React, { useEffect, useState } from "react";
import { useTelegram } from "./useTelegram";
import { loginWithTelegram } from "./api";

export default function Login({ onLoggedIn }) {
  const { initData, isTelegram } = useTelegram();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function doLogin() {
      const isLocalhost = 
        window.location.hostname === "localhost" || 
        window.location.hostname === "127.0.0.1";

      if (!initData && !isLocalhost) {
        // ትንሽ ሰከንድ በመጠበቅ ቴሌግራም initData እስኪጭን እድል መስጠት
        return;
      }

      try {
        let user;
        if (isLocalhost && !initData) {
          user = {
            telegramId: "494653076",
            firstName: "Tesfaye",
            username: "admin_test",
            balance: 1000,
            bonusBalance: 200,
            isAdmin: true,
            role: "admin",
            token: "mock-local-token"
          };
        } else {
          user = await loginWithTelegram(initData);
        }
        
        onLoggedIn(user);
      } catch (err) {
        // 🔍 ትክክለኛው የሰርቨር ስህተት ምን እንደሆነ በቀጥታ በስክሪኑ ላይ ማሳየት
        const serverError = err.response?.data?.error || err.response?.data?.message || err.message;
        setError(`Login failed: ${serverError}`);
      } finally {
        setLoading(false);
      }
    }

    const isLocalhost = 
      window.location.hostname === "localhost" || 
      window.location.hostname === "127.0.0.1";

    if (initData || isLocalhost) {
      doLogin();
    } else {
      // ከ 2 ሰከንድ በላይ initData ከጠፋ የስህተት መልእክት ማሳየት
      const timer = setTimeout(() => {
        if (!initData) {
          setError("Telegram initData not found. Please reopen the app from Telegram.");
          setLoading(false);
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [initData]);

  if (loading) {
    return (
      <div className="center-screen" style={{ color: "#fff", textAlign: "center", padding: "20px" }}>
        Signing you in…
      </div>
    );
  }

  if (error) {
    return (
      <div className="center-screen" style={{ textAlign: "center", color: "#fff", padding: "20px" }}>
        <p style={{ color: "#e74c3c", fontSize: "14px", marginBottom: "15px", wordBreak: "break-all" }}>
          {error}
        </p>
        <p style={{ color: "#aaa", fontSize: "11px", background: "#1a1a2e", padding: "10px", borderRadius: "8px" }}>
          Environment: {isTelegram ? "Telegram WebApp" : "Browser"} <br />
          InitData Status: {initData ? "Loaded" : "Empty"}
        </p>
      </div>
    );
  }

  return null;
}