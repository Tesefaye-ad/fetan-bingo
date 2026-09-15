import { useState, useEffect } from "react";

export function useTelegram() {
  const tg = window.Telegram?.WebApp;
  const rawInitData = tg?.initData || "";
  
  const [telegramUser, setTelegramUser] = useState(tg?.initDataUnsafe?.user || null);
  const [isTelegram, setIsTelegram] = useState(Boolean(tg && tg.initData));
  const [initData, setInitData] = useState(rawInitData);

  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      if (tg.initData) {
        setInitData(tg.initData);
        setTelegramUser(tg.initDataUnsafe?.user || null);
        setIsTelegram(true);
      }
    } else {
      // 💻 ኮምፒውተር ላይ (Localhost) ሲሞክሩ እንደ አድሚን ሆኖ እንዲሰራ
      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        setIsTelegram(true);
        setTelegramUser({
          id: 494653076,
          first_name: "Test Admin",
          username: "admin_test",
        });
      }
    }
  }, [tg]);

  return {
    telegramUser,
    isTelegram,
    initData,
    webApp: tg,
  };
}