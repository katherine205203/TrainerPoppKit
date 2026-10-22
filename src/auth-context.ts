import { createContext, useContext } from "react";

export type AuthContextValue = { authenticated: boolean; refresh: () => Promise<void>; signOut: () => Promise<void> };
export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside the app.");
  return value;
}
