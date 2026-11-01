import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get("/api/v1/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email, password) => {
    const me = await api.post("/api/v1/auth/login", { email, password });
    setUser(me);
    return me;
  };

  const register = async (email, password) => {
    const me = await api.post("/api/v1/auth/register", { email, password });
    setUser(me);
    return me;
  };

  const logout = async () => {
    try {
      await api.post("/api/v1/auth/logout");
    } catch {
      /* ignore */
    }
    setUser(null);
  };

  const deleteAccount = async () => {
    await api.delete("/api/v1/auth/account");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
