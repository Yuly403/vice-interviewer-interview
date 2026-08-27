/**
 * OAuth callback compatibility screen. The backend now sets an HttpOnly cookie
 * and redirects here without exposing credentials in query parameters.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("session missing");
        navigate("/", { replace: true });
      })
      .catch(() => setError("登录会话建立失败，请重新登录"));
  }, [navigate]);

  if (error) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h1 className="login-title">登录失败</h1>
          </div>
          <div className="login-error">{error}</div>
          <button className="login-btn" onClick={() => navigate("/login", { replace: true })}>
            返回登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1 className="login-title">第二面试官</h1>
          <p className="login-subtitle">登录中，请稍候…</p>
        </div>
        <div className="login-loading-spinner" />
      </div>
    </div>
  );
}
