import { io } from "socket.io-client";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

let socket = null;

export function getSocket() {
  if (socket && socket.connected) return socket;

  const token = localStorage.getItem("bingo_token");
  socket = io(API_BASE_URL, {
    auth: { token },
    // 👈 WebSocket ብቻ — Polling አጥፋ
    transports: ["websocket"],
    upgrade: false,
    // 👈 ፈጣን reconnection
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 2000,
    reconnectionAttempts: Infinity,
    timeout: 5000,
    // 👈 ፈጣን ምላሽ
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