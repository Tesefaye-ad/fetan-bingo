import React, { useEffect } from "react";
import { useTelegram } from "./useTelegram";
import { loginWithTelegram } from "./api";

export default function Login({ onLoggedIn }) {
  const { initData, ready, telegramUser } = useTelegram();

  useEffect(() => {
    if (!ready) return;

    // ከቴሌግራም ውጭ ከሆነ (initData ከሌለ) ወዲያውኑ ወደ ጨዋታው ግባ
    if (!initData) {
      const mockUser = {
        id: "local_admin",
        telegramId: telegramUser?.id ? String(telegramUser.id) : "494653076",
        firstName: telegramUser?.first_name || "Player", // 👈 የቴሌግራሙን ስም ይወስዳል
        username: telegramUser?.username || "player",
        balance: 1000,
        bonusBalance: 200,
        gamesWon: 0,
        referralCount: 0,
        isAdmin: true,
        token: "mock-local-token"
      };
      onLoggedIn(mockUser);
      return;
    }

    // በቴሌግራም ውስጥ ከሆነ ከ Backend ጋር ተገናኝ
    async function handleLogin() {
      try {
        const user = await loginWithTelegram(initData);
        onLoggedIn(user);
      } catch (err) {
        console.warn("Backend login failed, using mock data:", err.message);
        // የ Backend ግንኙነት ካልተሳካ ወዲያውኑ የሙከራ ተጠቃሚ ተጠቀም
        const mockUser = {
          id: "local_admin",
          telegramId: telegramUser?.id ? String(telegramUser.id) : "494653076",
          firstName: telegramUser?.first_name || "Player",
          username: telegramUser?.username || "player",
          balance: 1000,
          bonusBalance: 200,
          gamesWon: 0,
          referralCount: 0,
          isAdmin: true,
          token: "mock-local-token"
        };
        onLoggedIn(mockUser);
      }
    }

    handleLogin();
  }, [ready, initData, telegramUser, onLoggedIn]);

  return null;
}