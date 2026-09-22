import { useEffect } from "react";
import { useTelegram } from "./useTelegram";
import { loginWithTelegram } from "./api";

const LOGIN_TIMEOUT_MS = 8000;

export default function Login({ onLoggedIn }) {
  const { initData, ready, telegramUser } = useTelegram();

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;

    // ═══════════════════════════════════════════════════
    // ከቴሌግራም ውጭ ከሆነ ብቻ mock user
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
        isAdmin: true,
        token: "mock-local-token",
      };
      onLoggedIn(mockUser);
      return;
    }

    // ═══════════════════════════════════════════════════
    // በቴሌግራም ውስጥ ከሆነ — ከ Backend ጋር ተገናኝ
    // ═══════════════════════════════════════════════════
    async function handleLogin() {
      try {
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

        // Backend ካልሰራ — የቴሌግራም መረጃ ብቻ ተጠቅም
        if (telegramUser?.id) {
          const fallbackUser = {
            id: String(telegramUser.id),
            telegramId: String(telegramUser.id),
            firstName: telegramUser.first_name || "Player",
            lastName: telegramUser.last_name || "",
            username: telegramUser.username || `user_${telegramUser.id}`,
            photoUrl: telegramUser.photo_url || "",
            balance: 0,
            bonusBalance: 0,
            gamesWon: 0,
            referralCount: 0,
            isAdmin: false, // 👈 ደህንነት
            token: null,
          };
          onLoggedIn(fallbackUser);
        } else {
          onLoggedIn(null);
        }
      }
    }

    handleLogin();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initData, onLoggedIn]);

  return null;
}