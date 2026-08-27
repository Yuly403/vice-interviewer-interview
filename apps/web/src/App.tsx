import React from "react";
import { Routes, Route, Link, Navigate } from "react-router-dom";
import { ToastContainer, PageSpinner } from "./components/ui";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { setTokenGetter } from "./lib/api";
import InterviewList from "./pages/InterviewList";
import Workbench from "./pages/Workbench";
import LoginPage from "./pages/LoginPage";
import AuthCallback from "./pages/AuthCallback";
import NotFound from "./pages/NotFound";

function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app">
      {/* Skip-to-content link for keyboard users */}
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>
      <ToastContainer />
      <header className="app-header" role="banner">
        <Link to="/" className="logo" aria-label="第二面试官首页">
          <span className="logo-mark" aria-hidden="true">V</span>
          <span>第二面试官</span>
        </Link>
        <nav className="app-header-right" aria-label="用户操作">
          {user && <span className="app-user">{user.displayName}</span>}
          {user && (
            <button className="app-logout-btn" onClick={logout} aria-label="退出登录">
              退出
            </button>
          )}
        </nav>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<RequireAuth><InterviewList /></RequireAuth>} />
          <Route path="/interview/:id" element={<RequireAuth><Workbench /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageSpinner text="验证身份..." />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AuthInit({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  React.useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthInit>
        <AppShell />
      </AuthInit>
    </AuthProvider>
  );
}
