import { useState, useEffect } from "react";

export function useTelegram() {
  const getTg = () => window.Telegram?.WebApp;

  const [telegramUser, setTelegramUser] = useState(() => getTg()?.initDataUnsafe?.user || null);
  const [initData, setInitData] = useState(() => getTg()?.initData || "");
  const [isTelegram, setIsTelegram] = useState(true);

  useEffect(() => {
    const tg = getTg();
    if (tg) {
      try {
        tg.ready();
        tg.expand();
      } catch (e) {
        console.warn("Telegram expand error:", e);
      }
      if (tg.initData) {
        setInitData(tg.initData);
      }
      if (tg.initDataUnsafe?.user) {
        setTelegramUser(tg.initDataUnsafe.user);
      }
    } else {
      // 💻 ከቴሌግራም ውጭ (በብሮውዘር) ሲከፈት እንዳይዘጋ በነባሪነት (Fallback) አድሚን ዩዘር መስጠት
      setTelegramUser({
        id: 494653076,
        first_name: "Tesfaye",
        username: "admin_test",
      });
    }
  }, []);

  return {
    telegramUser,
    isTelegram: true, // አፑ በምንም መልኩ እንዳይዘጋ ሁልጊዜ true እንዲሆን ተደርጓል
    initData,
    webApp: getTg(),
  };
}