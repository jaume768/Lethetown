import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";

/** Roles de menor a mayor: cada uno puede todo lo del anterior. */
export const ROLES = ["viewer", "director", "admin"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export function hasRole(user: { role: Role } | null | undefined, needed: Role): boolean {
  if (needed === "viewer") return true;
  return Boolean(user) && ROLES.indexOf(user!.role) >= ROLES.indexOf(needed);
}

export interface User {
  id: string;
  username: string;
  role: Role;
  provider: string;
}

export const Username = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]{3,32}$/, "usuario: 3-32 letras, números, _ . -");
export const Password = z
  .string()
  .min(10, "la contraseña debe tener al menos 10 caracteres")
  .max(200);

/**
 * Proveedor de identidad. Hoy solo "local" (usuario + contraseña); un proveedor OAuth
 * implementaría `findOrCreateOAuth` con su `provider` y el `sub` del token.
 */
export interface UserStore {
  create(u: { username: string; role: Role; password: string }): Promise<User>;
  /** Comprueba usuario y contraseña; null si no coinciden. */
  authenticate(username: string, password: string): Promise<User | null>;
  get(id: string): Promise<User | null>;
  findOrCreateOAuth(provider: string, subject: string, username: string): Promise<User>;
}

export interface SessionStore {
  /** Crea una sesión y devuelve el token (va en la cookie; aquí solo se guarda su hash). */
  create(userId: string, ttlMs: number): Promise<string>;
  /** Usuario de un token válido y no caducado. */
  resolve(token: string): Promise<string | null>;
  destroy(token: string): Promise<void>;
}

/** Parámetros argon2id (OWASP: m=19 MiB, t=2, p=1). */
const ARGON2 = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON2);
/**
 * Hash con el que se compara cuando el usuario no existe, para que la respuesta tarde lo mismo
 * (no revela qué usuarios existen).
 */
let dummyHash: Promise<string> | null = null;

async function checkPassword(stored: string | null | undefined, password: string) {
  dummyHash ??= hashPassword(randomUUID());
  const target = stored ?? (await dummyHash);
  const ok = await verify(target, password).catch(() => false);
  return ok && Boolean(stored);
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

const toUser = (r: { id: string; username: string; role: string; provider: string }): User => ({
  id: r.id,
  username: r.username,
  role: Role.catch("viewer").parse(r.role),
  provider: r.provider,
});

// --- Postgres ------------------------------------------------------------------------------

export class PgUserStore implements UserStore {
  constructor(private readonly db: Db) {}

  async create(u: { username: string; role: Role; password: string }) {
    const [row] = await this.db
      .insert(users)
      .values({
        id: randomUUID(),
        username: u.username,
        role: u.role,
        passwordHash: await hashPassword(u.password),
      })
      .returning();
    return toUser(row!);
  }

  async authenticate(username: string, password: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.username, username), eq(users.provider, "local")));
    return (await checkPassword(row?.passwordHash, password)) && row ? toUser(row) : null;
  }

  async get(id: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ? toUser(row) : null;
  }

  async findOrCreateOAuth(provider: string, subject: string, username: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.provider, provider), eq(users.providerSubject, subject)));
    if (row) return toUser(row);
    const [created] = await this.db
      .insert(users)
      .values({ id: randomUUID(), username, role: "viewer", provider, providerSubject: subject })
      .returning();
    return toUser(created!);
  }
}

export class PgSessionStore implements SessionStore {
  constructor(private readonly db: Db) {}

  async create(userId: string, ttlMs: number) {
    const token = newToken();
    await this.db.insert(sessions).values({
      tokenHash: tokenHash(token),
      userId,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    // Limpieza oportunista de sesiones caducadas.
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    return token;
  }

  async resolve(token: string) {
    const [row] = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())));
    return row?.userId ?? null;
  }

  async destroy(token: string) {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
  }
}

// --- RAM (desarrollo sin Postgres y tests) ------------------------------------------------

export class InMemoryUserStore implements UserStore {
  private readonly byId = new Map<
    string,
    User & { passwordHash: string | null; subject?: string }
  >();

  async create(u: { username: string; role: Role; password: string }) {
    if ([...this.byId.values()].some((x) => x.username === u.username)) {
      throw new Error(`El usuario ${u.username} ya existe`);
    }
    const user = {
      id: randomUUID(),
      username: u.username,
      role: u.role,
      provider: "local",
      passwordHash: await hashPassword(u.password),
    };
    this.byId.set(user.id, user);
    return toUser(user);
  }

  async authenticate(username: string, password: string) {
    const row = [...this.byId.values()].find(
      (u) => u.username === username && u.provider === "local",
    );
    return (await checkPassword(row?.passwordHash, password)) && row ? toUser(row) : null;
  }

  async get(id: string) {
    const row = this.byId.get(id);
    return row ? toUser(row) : null;
  }

  async findOrCreateOAuth(provider: string, subject: string, username: string) {
    const row = [...this.byId.values()].find(
      (u) => u.provider === provider && u.subject === subject,
    );
    if (row) return toUser(row);
    const user = {
      id: randomUUID(),
      username,
      role: "viewer" as const,
      provider,
      subject,
      passwordHash: null,
    };
    this.byId.set(user.id, user);
    return toUser(user);
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly items = new Map<string, { userId: string; expiresAt: number }>();

  async create(userId: string, ttlMs: number) {
    const token = newToken();
    this.items.set(tokenHash(token), { userId, expiresAt: Date.now() + ttlMs });
    return token;
  }

  async resolve(token: string) {
    const s = this.items.get(tokenHash(token));
    return s && s.expiresAt > Date.now() ? s.userId : null;
  }

  async destroy(token: string) {
    this.items.delete(tokenHash(token));
  }
}
