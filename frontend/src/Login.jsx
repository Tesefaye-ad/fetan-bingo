import { useEffect } from "react";
import { useTelegram } from "./useTelegram";
import { loginWithTelegram } from "./api";

const LOGIN_TIMEOUT_MS = 10000;

export default function Login({ onLoggedIn }) {
  const { initData, ready, telegramUser } = useTelegram();

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;

    // ═══════════════════════════════════════════════════
    // 👈 ከቴሌግራም ውጭ — DEVELOPMENT ውስጥ ብቻ mock
    // ═══════════════════════════════════════════════════
    if (!initData) {
      const isDev = process.env.NODE_ENV === "development";

      if (!isDev) {
        // Production ላይ — ምንም mock የለም
        console.warn(
          "[Login] No Telegram initData. Please open this app inside Telegram."
        );
        onLoggedIn(null);
        return;
      }

      // 👈 Development mock — isAdmin: false (ደህንነት)
      const mockUser = {
        id: "local_dev_user",
        telegramId: telegramUser?.id ? String(telegramUser.id) : "000000000",
        firstName: telegramUser?.first_name || "Dev",
        lastName: telegramUser?.last_name || "",
        username: telegramUser?.username || "dev_user",
        balance: 1000,
        bonusBalance: 200,
        gamesWon: 0,
        referralCount: 0,
        isAdmin: false, // 👈 ወሳኝ ማስተካከያ
        token: null,
      };
      onLoggedIn(mockUser);
      return;
    }

    // ═══════════════════════════════════════════════════
    // በቴሌግራም ውስጥ — ከ Backend ጋር ተገናኝ
    // ═══════════════════════════════════════════════════
    async function handleLogin() {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Login timeout")), LOGIN_TIMEOUT_MS)
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
            isAdmin: false,
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