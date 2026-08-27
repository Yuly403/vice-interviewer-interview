/**
 * AuthContext — HttpOnly-cookie session + user state
 *
 * Provides: login(), logout(), refreshToken(), user, token, isAuthenticated
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { setUnauthorizedHandler } from "../lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  feishuOpenId: string;
  displayName: string;
  email: string | null;
  role: string;
  avatarUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (feishuOpenId: string, displayName: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<string | null>;
  getToken: () => string | null;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  // The server owns session validity. No credential is ever kept in localStorage.
  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "include" })
      .then(async (res) => res.ok ? (await res.json()).data as AuthUser : null)
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(undefined);
  }, []);

  const login = useCallback(async (feishuOpenId: string, displayName: string) => {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feishuOpenId, displayName }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Login failed" }));
      throw new Error(err.message || `Login failed (${res.status})`);
    }

    const { data } = await res.json();
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    void fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }, []);

  const refreshTokenFn = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Refresh failed");
      const me = await fetch("/api/v1/auth/me", { credentials: "include" });
      if (!me.ok) throw new Error("Session refresh did not produce a user");
      setUser((await me.json()).data as AuthUser);
      return "cookie-session";
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  const getToken = useCallback(() => null, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
      refreshToken: refreshTokenFn,
      getToken,
    }),
    [user, isLoading, login, logout, refreshTokenFn, getToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
