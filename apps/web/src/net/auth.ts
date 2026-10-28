import { useSyncExternalStore } from "react";
import { reconnect } from "./store";

export type Role = "viewer" | "director" | "admin";
export interface User {
  id: string;
  username: string;
  role: Role;
}

const RANK: Record<Role, number> = { viewer: 0, director: 1, admin: 2 };

let user: User | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

export function hasRole(u: User | null, role: Role): boolean {
  return Boolean(u) && RANK[u!.role] >= RANK[role];
}

/** Sesión actual (cookie httpOnly: el cliente solo pregunta quién es). */
export async function refreshMe(): Promise<User | null> {
  try {
    const res = await fetch("/api/auth/me");
    user = res.ok ? ((await res.json()) as { user: User | null }).user : null;
  } catch {
    user = null;
  }
  loaded = true;
  notify();
  return user;
}

export async function login(username: string, password: string): Promise<User> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error);
  user = ((await res.json()) as { user: User }).user;
  notify();
  reconnect();
  return user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  user = null;
  notify();
  reconnect();
}

export function useAuth(): { user: User | null; loaded: boolean } {
  const u = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => user,
  );
  return { user: u, loaded };
}
