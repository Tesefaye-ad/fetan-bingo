import { io } from "socket.io-client";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

let socket = null;

export function getSocket() {
  if (socket && socket.connected) return socket;
  // ከተገናኘ በኋላ socket.connected === false ሊሆን ይችላል
  // ነገር ግን socket instance ካለ እንደገና አትፍጠር — እራሱ ይገናኛል
  if (socket) return socket;

  const token = localStorage.getItem("bingo_token");
  socket = io(API_BASE_URL, {
    auth: { token },
    // 👈 WebSocket ቀዳሚ፣ polling fallback (firewall-friendly)
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