import { io } from "socket.io-client";

const API_BASE_URL = process.env.REACT_APP_API_URL || "https://fetan-bingo-he4x.onrender.com";

let socket = null;

export function getSocket() {
  if (socket && socket.connected) return socket;
  const token = localStorage.getItem("bingo_token");
  socket = io(API_BASE_URL, {
    auth: { token },
    transports: ["websocket"], // 👈 "polling" አጥፍተን በ WebSocket ብቻ እንዲሰራ አድርገናል
    upgrade: false,            // 👈 ወደ WebSocket ለመቀየር ምንም እንዳይጠብቅ
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}