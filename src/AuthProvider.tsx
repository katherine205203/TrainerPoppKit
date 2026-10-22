import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api, post } from "./api";
import { AuthContext } from "./auth-context";
import { LoadingState } from "./components";

function isPublicRoute(path: string): boolean {
  return path === "/join" || path.startsWith("/join/") || path === "/presenter" || path.startsWith("/participate/");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [authResolvedPath, setAuthResolvedPath] = useState<string | null>(null);
  const location = useLocation();
  const publicRoute = isPublicRoute(location.pathname);

  const refresh = useCallback(async () => {
    try {
      const result = await api<{ authenticated: boolean }>("/auth/me");
      setAuthenticated(result.authenticated);
    } catch {
      setAuthenticated(false);
    } finally {
      setAuthResolvedPath(location.pathname);
    }
  }, [location.pathname]);

  const signOut = useCallback(async () => {
    try { await post("/auth/logout"); } finally { setAuthenticated(false); }
  }, []);

  useEffect(() => {
    let active = true;
    if (publicRoute) return () => { active = false; };
    api<{ authenticated: boolean }>("/auth/me").then((result) => {
      if (active) setAuthenticated(result.authenticated);
    }).catch(() => {
      if (active) setAuthenticated(false);
    }).finally(() => {
      if (active) setAuthResolvedPath(location.pathname);
    });
    return () => { active = false; };
  }, [location.pathname, publicRoute]);

  const authValue = useMemo(() => ({ authenticated, refresh, signOut }), [authenticated, refresh, signOut]);
  const authLoaded = publicRoute || authResolvedPath === location.pathname;
  if (!authLoaded) return <LoadingState label="Opening your trainer space…" />;
  return <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>;
}
