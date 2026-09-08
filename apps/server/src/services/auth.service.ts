import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { User, Workspace } from "@tracklane/domain";
import { SignJWT, jwtVerify } from "jose";
import { unauthorized } from "../errors.js";
import type { UserRepository } from "../repositories/user.repository.js";
import type { WorkspaceRepository } from "../repositories/workspace.repository.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
const DUMMY_HASH = `scrypt$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(KEY_LENGTH).toString("base64")}`;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = encoded.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface TokenClaims {
  userId: string;
  workspaceId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface AuthenticatedSession {
  user: User;
  expiresAt: number;
}

export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    private readonly users: UserRepository,
    private readonly workspaces: WorkspaceRepository,
    jwtSecret: string,
    private readonly tokenTtlSeconds: number,
  ) {
    this.secret = new TextEncoder().encode(jwtSecret);
  }

  async login(email: string, password: string): Promise<{ token: string; user: User; workspace: Workspace }> {
    const credentials = await this.users.findCredentials(email);
    // Verify against a dummy hash for unknown emails so response time doesn't reveal which accounts exist.
    const valid = await verifyPassword(password, credentials?.passwordHash ?? DUMMY_HASH);
    if (!credentials || !valid) throw unauthorized("Email or password is incorrect");
    const workspace = await this.workspaces.findWorkspace(credentials.user.workspaceId);
    if (!workspace) throw unauthorized("Your workspace no longer exists");
    return { token: await this.issueToken(credentials.user), user: credentials.user, workspace };
  }

  async issueToken(user: User): Promise<string> {
    return new SignJWT({ wid: user.workspaceId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${this.tokenTtlSeconds}s`)
      .sign(this.secret);
  }

  async verifyToken(token: string): Promise<TokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ["HS256"] });
      if (typeof payload.sub !== "string" || typeof payload.wid !== "string" || typeof payload.exp !== "number") {
        throw unauthorized();
      }
      return { userId: payload.sub, workspaceId: payload.wid, expiresAt: payload.exp * 1_000 };
    } catch {
      throw unauthorized("Your session has expired");
    }
  }

  async authenticate(token: string): Promise<User> {
    return (await this.authenticateSession(token)).user;
  }

  async authenticateSession(token: string): Promise<AuthenticatedSession> {
    const claims = await this.verifyToken(token);
    const user = await this.users.findById(claims.userId);
    if (!user || user.workspaceId !== claims.workspaceId) throw unauthorized();
    return { user, expiresAt: claims.expiresAt };
  }
}
