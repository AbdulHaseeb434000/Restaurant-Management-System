"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { setCurrency } from "./format";
import type { AppSettings, Role, User } from "./types";

interface AuthState {
  user: User | null;
  settings: AppSettings | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  refreshSettings: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    const s = await api.get<AppSettings>("/settings");
    setCurrency(s.currency);
    setSettings(s);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    Promise.all([api.get<User>("/auth/me"), refreshSettings()])
      .then(([u]) => setUser(u))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, [refreshSettings]);

  const login = useCallback(
    async (username: string, password: string) => {
      const body = new URLSearchParams({ username, password });
      const res = await api.post<{ access_token: string; user: User }>("/auth/login", body);
      setToken(res.access_token);
      await refreshSettings();
      setUser(res.user);
      return res.user;
    },
    [refreshSettings],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  }, []);

  const hasRole = useCallback(
    (...roles: Role[]) => !!user && (user.role === "admin" || roles.includes(user.role)),
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, settings, loading, login, logout, refreshSettings, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Default landing page per role */
export function homeFor(role: Role): string {
  switch (role) {
    case "kitchen":
      return "/kitchen";
    case "storekeeper":
      return "/inventory/stock";
    case "waiter":
      return "/tables";
    case "cashier":
      return "/pos";
    default:
      return "/";
  }
}
