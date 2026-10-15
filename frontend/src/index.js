import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Shows the real error instead of a blank screen if anything crashes at runtime.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          textAlign: "center",
          color: "#fff",
        }}
      >
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div style={{ fontWeight: 700 }}>ስህተት ተፈጥሯል</div>
        <div
          style={{
            fontSize: 12,
            opacity: 0.7,
            maxWidth: 320,
            wordBreak: "break-word",
          }}
        >
          {String(this.state.error?.message || this.state.error)}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: "#27ae60",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            padding: "12px 28px",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          🔄 እንደገና ጫን
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
