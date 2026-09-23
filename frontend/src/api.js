import axios from "axios";
import { io } from "socket.io-client";
import { useState, useEffect, useRef, useMemo } from "react";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("bingo_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ═══════════════════════════════════════════════════════
// SOCKET (ከ socket.js የተዋሃደ)
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
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    reconnectionAttempts: Infinity,
    timeout: 8000,
    forceNew: false,
    multiplex: true,
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
// useTelegram HOOK (ከ useTelegram.js የተዋሃደ)
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
// API FUNCTIONS
// ═══════════════════════════════════════════════════════
export async function loginWithTelegram(initData) {
  if (!initData) throw new Error("Telegram initData is missing.");
  const { data } = await api.post("/api/auth/telegram", { initData });
  localStorage.setItem("bingo_token", data.token);
  localStorage.setItem("telegramId", data.user.telegramId);
  return data.user;
}

export async function createRoom(entryFee, roomCode) {
  const body = { entryFee };
  if (roomCode) body.roomCode = roomCode;
  const { data } = await api.post("/api/game/rooms", body);
  return data;
}

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

export default api;