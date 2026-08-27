import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import "./LoginPage.css";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "登录失败，请稍后重试";
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [showMock, setShowMock] = useState(false);
  const [feishuOpenId, setFeishuOpenId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mockError, setMockError] = useState("");
  const [mockLoading, setMockLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const mockEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_AUTH === "true";

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) setOauthError(decodeURIComponent(err));
  }, [searchParams]);

  const handleFeishuLogin = () => {
    window.location.href = "/api/v1/auth/feishu/redirect";
  };

  const handleMockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feishuOpenId.trim() || !displayName.trim()) {
      setMockError("请输入飞书 OpenID 和显示名称");
      return;
    }
    setMockError("");
    setMockLoading(true);
    try {
      await login(feishuOpenId.trim(), displayName.trim());
      navigate("/", { replace: true });
    } catch (err) {
      setMockError(getErrorMessage(err));
    } finally {
      setMockLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">第二面试官</h1>
        <p className="login-subtitle">内部试点 · 飞书账号登录</p>

        {oauthError && <div className="login-error">{oauthError}</div>}

        <button className="login-btn login-btn-feishu" onClick={handleFeishuLogin}>
          📱 飞书账号一键登录
        </button>

        <p className="login-hint">
          使用你的飞书账号登录第二面试官，首次使用将自动创建账号。
        </p>

        {mockEnabled && (
          <button
            className="login-mock-toggle"
            onClick={() => setShowMock((v) => !v)}
            title="仅限本地合成测试"
          >
            {showMock ? "收起模拟登录" : "打开模拟登录"}
          </button>
        )}

        {mockEnabled && showMock && (
          <form className="login-form login-form-mock" onSubmit={handleMockSubmit}>
            <div className="login-field">
              <label htmlFor="feishuOpenId">飞书 OpenID</label>
              <input
                id="feishuOpenId"
                type="text"
                placeholder="ou_xxxxxxxxxxxxx"
                value={feishuOpenId}
                onChange={(e) => setFeishuOpenId(e.target.value)}
                autoFocus
                disabled={mockLoading}
              />
            </div>
            <div className="login-field">
              <label htmlFor="displayName">显示名称</label>
              <input
                id="displayName"
                type="text"
                placeholder="张三"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={mockLoading}
              />
            </div>
            {mockError && <div className="login-error">{mockError}</div>}
            <button type="submit" className="login-btn" disabled={mockLoading}>
              {mockLoading ? "登录中..." : "模拟登录"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
