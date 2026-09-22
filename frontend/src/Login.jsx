import { useEffect } from "react";
import { useTelegram } from "./useTelegram";
import { loginWithTelegram } from "./api";

// 👈 የ Backend ጥሪ timeout (cold start + network)
const LOGIN_TIMEOUT_MS = 8000;

export default function Login({ onLoggedIn }) {
  const { initData, ready, telegramUser } = useTelegram();

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;

    // ═══════════════════════════════════════════════════
    // 👈 ከቴሌግራም ውጭ ከሆነ ብቻ mock user ተጠቀም
    // ═══════════════════════════════════════════════════
    if (!initData) {
      const mockUser = {
        id: "local_admin",
        telegramId: telegramUser?.id ? String(telegramUser.id) : "494653076",
        firstName: telegramUser?.first_name || "Player",
        username: telegramUser?.username || "player",
        balance: 1000,
        bonusBalance: 200,
        gamesWon: 0,
        referralCount: 0,
        // 👈 ከቴሌግራም ውጭ ብቻ admin ነው
        isAdmin: true,
        token: "mock-local-token",
      };
      onLoggedIn(mockUser);
      return;
    }

    // ═══════════════════════════════════════════════════
    // 👈 በቴሌግራም ውስጥ ከሆነ — ከ Backend ጋር ተገናኝ
    // ═══════════════════════════════════════════════════
    async function handleLogin() {
      try {
        // 👈 Timeout ጨምር — 8s በላይ ከወሰደ ወዲያውኑ fail አድርግ
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Login timeout")),
            LOGIN_TIMEOUT_MS
          )
        );

        const user = await Promise.race([
          loginWithTelegram(initData),
          timeoutPromise,
        ]);

        if (cancelled) return;

        localStorage.setItem("telegramId", user.telegramId);
        onLoggedIn(user);
      } catch (err) {
        if (cancelled) return;

        console.error("[Login] Failed:", err.message);

        // ═══════════════════════════════════════════════
        // 👈 Backend ካልሰራ — የቴሌግራም መረጃ ብቻ ተጠቅም
        // ═══════════════════════════════════════════════
        if (telegramUser?.id) {
          const fallbackUser = {
            id: String(telegramUser.id),
            telegramId: String(telegramUser.id),
            firstName: telegramUser.first_name || "Player",
            lastName: telegramUser.last_name || "",
            username: telegramUser.username || `user_${telegramUser.id}`,
            photoUrl: telegramUser.photo_url || "",
            balance: 0,        // 👈 ከ DB ስላልመጣ 0 ነው
            bonusBalance: 0,
            gamesWon: 0,
            referralCount: 0,
            // 👈 እውነተኛ ተጠቃሚ ነው — admin አይደለም
            isAdmin: false,
            token: null,
          };
          onLoggedIn(fallbackUser);
        } else {
          // የቴሌግራም መረጃም የለም — ወደ ስህተት ገጽ
          onLoggedIn(null);
        }
      }
    }

    handleLogin();

    return () => {
      cancelled = true;
    };
  }, [ready, initData, telegramUser?.id, onLoggedIn]);

  return null;
}