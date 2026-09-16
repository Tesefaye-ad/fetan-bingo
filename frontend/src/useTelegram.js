import { useState, useEffect } from "react";

export function useTelegram() {
  const getTg = () => window.Telegram?.WebApp;

  const [telegramUser, setTelegramUser] = useState(null);
  const [initData, setInitData] = useState("");
  const [isTelegram, setIsTelegram] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const tg = getTg();
    if (tg && tg.initData) {
      try {
        tg.ready();
        tg.expand();
      } catch (e) {}
      setInitData(tg.initData);
      setTelegramUser(tg.initDataUnsafe?.user || null);
      setIsTelegram(true);
    } else {
      setIsTelegram(false);
    }
    setReady(true);
  }, []);

  return { telegramUser, initData, isTelegram, ready, webApp: getTg() };
}