import { createContext, useContext } from "react";

export type AuthUser = {
  id: string;
  username: string;
  role: "admin" | "user";
  status: "approved" | "pending" | "rejected";
  created_at: string;
};

export type AuthStatus = {
  multi_user_enabled: boolean;
  approval_required: boolean;
  local_only: boolean;
  engine_2d_enabled: boolean;
  engine_3d_enabled: boolean;
  engine_openfilm_enabled: boolean;
  account_count: number;
  registration_open: boolean;
};

export type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus | null;
  refreshStatus: () => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthGate.");
  return value;
}
