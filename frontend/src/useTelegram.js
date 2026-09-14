import { useState, useEffect } from "react";

export function useTelegram() {
  const [telegramUser, setTelegramUser] = useState(null);
  const [isTelegram, setIsTelegram] = useState(false);
  const [initData, setInitData] = useState(""); // 👈 Login.jsx ወደ ባክኤንድ የሚልከው ራው initData string

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (tg && tg.initData) {
      // ቴሌግራም ውስጥ ሲከፈት
      setIsTelegram(true);
      setInitData(tg.initData); // 👈 ይሄ ከዚህ በፊት ጨርሶ አልተመለሰም ነበር - ለ Login.jsx ስህተት ዋናው ምክንያት
      setTelegramUser(tg.initDataUnsafe?.user || null);
      tg.ready();
      tg.expand();
    } else {
      // 💻 ኮምፒውተርዎ ላይ (Browser / Localhost) ሲሞክሩት ስህተት እንዳያሳይ
      // እና አድሚን ሆኖ እንዲፈትኑት ፦
      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        setIsTelegram(true);
        setTelegramUser({
          id: 494653076, // 👈 የእርስዎ የአድሚን ID ሆኖ በሎካል እንዲሞከር ያደርገዋል
          first_name: "Test Admin",
          username: "admin_test",
        });
      }
    }
  }, []);

  return {
    telegramUser,
    isTelegram,
    initData,
    webApp: window.Telegram?.WebApp,
  };
}