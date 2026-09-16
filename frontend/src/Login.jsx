import { useEffect } from "react";
import { useTelegram } from "./useTelegram";
import { loginWithTelegram } from "./api";

export default function Login({ onLoggedIn }) {
  const { initData, ready } = useTelegram();

  useEffect(() => {
    if (!ready) return;

    // 1. ከቴሌግራም ውጭ ከሆነ (initData ከሌለ) ወዲያውኑ ወደ ጨዋታው ግባ
    if (!initData) {
      const mockUser = {
        id: "local_admin",
        telegramId: "494653076",
        firstName: "Tesfaye",
        username: "admin_test",
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

    // 2. በቴሌግራም ውስጥ ከሆነ ከ Backend ጋር ተገናኝ
    async function handleLogin() {
      try {
        const user = await loginWithTelegram(initData);
        onLoggedIn(user);
      } catch (err) {
        console.warn("Backend login failed, using mock data:", err.message);
        // የ Backend ግንኙነት ካልተሳካ ወዲያውኑ የሙከራ ተጠቃሚ ተጠቀም
        const mockUser = {
          id: "local_admin",
          telegramId: "494653076",
          firstName: "Tesfaye",
          username: "admin_test",
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
  }, [ready, initData, onLoggedIn]);

  // ምንም Loading ሳያሳይ ባዶ ገጽ ብቻ ይመልስ (ወዲያውኑ ይገባል)
  return null;
}