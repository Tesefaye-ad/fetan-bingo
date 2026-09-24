import axios from "axios";
import { io } from "socket.io-client";
import { useState, useEffect, useRef, useMemo } from "react";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

// ═══════════════════════════════════════════════════════
// AXIOS — short timeout for most, long for auth
// ═══════════════════════════════════════════════════════
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000, // 👈 15s ለአብዛኞቹ
  headers: { "Content-Type": "application/json" },
});

// 👈 Retry interceptor — 1 ጊዜ ብቻ
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    const isNetwork =
      !error.response ||
      error.code === "ECONNABORTED" ||
      error.message === "Network Error";

    // Retry በአንድ ጊዜ ብቻ
    if (isNetwork && config && !config._retry && config._retryCount !== 1) {
      config._retry = true;
      config._retryCount = 1;
      await new Promise((r) => setTimeout(r, 1500));
      return api(config);
    }

    return Promise.reject(error);
  }
);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("bingo_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ═══════════════════════════════════════════════════════
// SOCKET — 60s connect timeout ለ cold start
// ═══════════════════════════════════════════════════════
let socket = null;

export function getSocket() {
  if (socket && socket.connected) return socket;
  if (socket) return socket;

  const token = localStorage.getItem("bingo_token");
  socket = io(API_BASE_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
    upgrade: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 60000,
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// ═══════════════════════════════════════════════════════
// useTelegram
// ═══════════════════════════════════════════════════════
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
        } catch (e) {}
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
      if (pollCount.current < 30) setTimeout(tryInit, 100);
      else {
        setIsTelegram(false);
        setReady(true);
      }
    }
    tryInit();
    return () => {
      cancelled = true;
    };
  }, []);

  const webApp = useMemo(() => getTg(), []);
  return { telegramUser, initData, isTelegram, ready, webApp };
}

// ═══════════════════════════════════════════════════════
// AUTH — long timeout ለ cold start
// ═══════════════════════════════════════════════════════
export async function loginWithTelegram(initData) {
  if (!initData) throw new Error("Telegram initData is missing.");
  const { data } = await api.post(
    "/api/auth/telegram",
    { initData },
    { timeout: 60000 } // 👈 auth ብቻ 60s
  );
  localStorage.setItem("bingo_token", data.token);
  localStorage.setItem("telegramId", data.user.telegramId);
  return data.user;
}

// ═══════════════════════════════════════════════════════
// CREATE ROOM — short timeout + fallback
// ═══════════════════════════════════════════════════════
export async function createRoom(entryFee, roomCode) {
  const body = { entryFee };
  if (roomCode) body.roomCode = roomCode;

  const fallbackCode =
    roomCode ||
    "ROOM" + (entryFee >= 100 ? "100" : entryFee >= 50 ? "50" : entryFee);

  try {
    const { data } = await api.post("/api/game/rooms", body, {
      timeout: 12000, // 👈 12s ብቻ
    });
    return data;
  } catch (err) {
    console.warn("[api] createRoom failed — using fallback:", err.message);
    // 👈 ሁልጊዜ fallback ተመልስ
    return {
      roomCode: fallbackCode,
      entryFee,
      status: "waiting",
      _fallback: true,
    };
  }
}

// ═══════════════════════════════════════════════════════
// WALLET
// ═══════════════════════════════════════════════════════
export async function getWalletHistory() {
  const { data } = await api.get("/api/wallet/history");
  return data.transactions;
}

export async function getBalance() {
  const { data } = await api.get("/api/wallet/balance");
  return data;
}

export async function initiateDeposit(amount) {
  const { data } = await api.post("/api/wallet/deposit/initiate", { amount });
  return data;
}

export async function withdraw(amount, phone, method) {
  const { data } = await api.post("/api/wallet/withdraw", {
    amount,
    phone,
    method,
  });
  return data.balance;
}

export async function transfer(toTelegramId, amount) {
  const { data } = await api.post("/api/wallet/transfer", {
    toTelegramId,
    amount,
  });
  return data.balance;
}

// ═══════════════════════════════════════════════════════
// USER
// ═══════════════════════════════════════════════════════
export async function getMe() {
  const { data } = await api.get("/api/user/me");
  return data.user;
}

export async function getLeaderboard() {
  const { data } = await api.get("/api/user/leaderboard");
  return data;
}

export async function getReferralInfo() {
  const { data } = await api.get("/api/user/referral");
  return data;
}

export async function getAchievements() {
  const { data } = await api.get("/api/user/achievements");
  return data.achievements;
}

export async function getGameHistory(limit = 30) {
  const { data } = await api.get(`/api/user/games/history?limit=${limit}`);
  return data.history;
}

export async function getNotifications(limit = 30) {
  const { data } = await api.get(`/api/user/notifications?limit=${limit}`);
  return data;
}

export async function markNotificationsRead() {
  const { data } = await api.post("/api/user/notifications/read");
  return data;
}

// ═══════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════
export async function adminGetStats() {
  const { data } = await api.get("/api/admin/stats");
  return data;
}

export async function adminGetTransactions({
  type,
  status,
  limit = 50,
  skip = 0,
} = {}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  params.set("limit", limit);
  params.set("skip", skip);
  const { data } = await api.get(`/api/admin/transactions?${params}`);
  return data;
}

export async function adminApproveTransaction(id) {
  const { data } = await api.post(`/api/admin/transactions/${id}/approve`);
  return data;
}

export async function adminRejectTransaction(id, reason) {
  const { data } = await api.post(`/api/admin/transactions/${id}/reject`, {
    reason,
  });
  return data;
}

export async function adminGetUsers({ q, limit = 50, skip = 0 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("limit", limit);
  params.set("skip", skip);
  const { data } = await api.get(`/api/admin/users?${params}`);
  return data;
}

export async function adminBanUser(id, banned) {
  const { data } = await api.post(`/api/admin/users/${id}/ban`, { banned });
  return data;
}

export async function adminBroadcast(title, body) {
  const { data } = await api.post("/api/admin/broadcast", { title, body });
  return data;
}

export async function adminAdjustBalance(id, amount, note) {
  const { data } = await api.post(`/api/admin/users/${id}/balance`, {
    amount,
    note,
  });
  return data;
}

export async function adminGetConfig() {
  const { data } = await api.get("/api/admin/config");
  return data;
}

export async function adminSaveConfig(ticketPrice, winnerPercent) {
  const { data } = await api.post("/api/admin/config", {
    ticketPrice,
    winnerPercent,
  });
  return data;
}

export async function adminSetDrawNumber(number) {
  const { data } = await api.post("/api/admin/draw/set", { number });
  return data;
}

export async function adminClearDrawNumber() {
  const { data } = await api.post("/api/admin/draw/clear");
  return data;
}

export default api;