import { useState, useEffect, useRef, useMemo } from "react";

export function useTelegram() {
  const getTg = () => window.Telegram?.WebApp;

  const [telegramUser, setTelegramUser] = useState(null);
  const [initData, setInitData] = useState("");
  const [isTelegram, setIsTelegram] = useState(false);
  const [ready, setReady] = useState(false);
  const pollCount = useRef(0);

  useEffect(() => {
    let cancelled = false;

    function tryInit() {
      if (cancelled) return;

      const tg = getTg();

      if (tg) {
        try {
          tg.ready();
          tg.expand();
          if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
        } catch (e) {
          console.warn("Telegram expand error:", e);
        }

        const data = tg.initData || "";
        const user = tg.initDataUnsafe?.user || null;

        if (data || user) {
          setInitData(data);
          setTelegramUser(user);
          setIsTelegram(true);
          setReady(true);
          return;
        }
      }

      pollCount.current += 1;
      if (pollCount.current < 30) {
        setTimeout(tryInit, 100);
      } else {
        setIsTelegram(false);
        setReady(true);
      }
    }

    tryInit();

    return () => {
      cancelled = true;
    };
  }, []);

  // 👈 webApp ለየትኛውም render አዲስ አይፈጠር
  const webApp = useMemo(() => getTg(), [ready]);

  return { telegramUser, initData, isTelegram, ready, webApp };
}