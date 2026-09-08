import { type DemoAccount, LoginRequest } from "@tracklane/domain";
import { type RequestHandler, Router } from "express";
import { tooManyRequests } from "../../errors.js";
import type { UserRepository } from "../../repositories/user.repository.js";
import type { WorkspaceRepository } from "../../repositories/workspace.repository.js";
import type { AuthService } from "../../services/auth.service.js";
import type { RateLimiter } from "../../services/rate-limiter.js";
import { accessOf } from "../context.js";

export interface AuthRoutesDeps {
  auth: AuthService;
  users: UserRepository;
  workspaces: WorkspaceRepository;
  requireAuth: RequestHandler;
  rateLimiter: RateLimiter;
  loginRateLimit: { max: number; windowSeconds: number };
  demoWorkspaceSlug: string | null;
}

export function authRoutes(deps: AuthRoutesDeps): Router {
  const router = Router();
  const windowMs = deps.loginRateLimit.windowSeconds * 1_000;

  // Limited per address and per account: the first stops one client hammering
  // scrypt, the second stops a botnet guessing one person's password.
  router.post("/login", async (req, res) => {
    const { email, password } = LoginRequest.parse(req.body);
    const checks = await Promise.all([
      deps.rateLimiter.hit(`login:ip:${req.ip ?? "unknown"}`, deps.loginRateLimit.max, windowMs),
      deps.rateLimiter.hit(`login:email:${email.toLowerCase()}`, deps.loginRateLimit.max, windowMs),
    ]);
    const blocked = checks.find((check) => !check.allowed);
    if (blocked) {
      res.set("Retry-After", String(Math.ceil(blocked.retryAfterMs / 1_000)));
      throw tooManyRequests(blocked.retryAfterMs);
    }
    res.json(await deps.auth.login(email, password));
  });

  router.get("/me", deps.requireAuth, (_req, res) => {
    const { user, teams } = accessOf(res);
    res.json({ user, teams });
  });

  router.get("/demo-accounts", async (_req, res) => {
    const workspace = deps.demoWorkspaceSlug ? await deps.workspaces.findBySlug(deps.demoWorkspaceSlug) : null;
    if (!workspace) {
      res.json({ accounts: [] });
      return;
    }
    const [users, teams] = await Promise.all([
      deps.users.listByWorkspace(workspace.id),
      deps.workspaces.listTeams(workspace.id),
    ]);
    const accounts: DemoAccount[] = users.map((user) => ({
      name: user.name,
      email: user.email,
      avatarHue: user.avatarHue,
      teams: teams.filter((team) => user.role === "admin" || team.memberIds.includes(user.id)).map((team) => team.name),
    }));
    res.json({ accounts });
  });

  return router;
}
