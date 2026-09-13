import axios from "axios";

const API_BASE_URL = process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

const api = axios.create({ baseURL: API_BASE_URL });

// Attach the stored JWT (set after Telegram login) to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("bingo_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export async function loginWithTelegram(initData) {
  const { data } = await api.post("/api/auth/telegram", { initData });
  localStorage.setItem("bingo_token", data.token);
  return data.user;
}

export function logout() {
  localStorage.removeItem("bingo_token");
}

export async function getBalance() {
  const { data } = await api.get("/api/wallet/balance");
  return data.balance;
}

export async function getWalletHistory() {
  const { data } = await api.get("/api/wallet/history");
  return data.transactions;
}

export async function getRooms() {
  const { data } = await api.get("/api/game/rooms");
  return data.rooms;
}

export async function createRoom(entryFee) {
  const { data } = await api.post("/api/game/rooms", { entryFee });
  return data;
}

export async function initiateDeposit(amount) {
  const { data } = await api.post("/api/wallet/deposit/initiate", { amount });
  return data;
}

export async function confirmDeposit(reference, amount) {
  const { data } = await api.post("/api/wallet/deposit/confirm", {
    reference,
    amount,
  });
  return data.balance;
}

export async function withdraw(amount) {
  const { data } = await api.post("/api/wallet/withdraw", { amount });
  return data.balance;
}

export default api;
