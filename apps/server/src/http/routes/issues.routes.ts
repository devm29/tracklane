import { Router } from "express";
import { z } from "zod";
import { badRequest } from "../../errors.js";
import type { WorkspaceRepository } from "../../repositories/workspace.repository.js";
import { accessOf } from "../context.js";

const Cursor = z.object({ updatedAt: z.iso.datetime(), id: z.uuid() });

const IssuesQuery = z.object({
  teamId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

function decodeCursor(raw: string | undefined): { updatedAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = Cursor.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return { updatedAt: new Date(parsed.updatedAt), id: parsed.id };
  } catch {
    throw badRequest("Invalid cursor");
  }
}

const encodeCursor = (updatedAt: string, id: string): string =>
  Buffer.from(JSON.stringify({ updatedAt, id }), "utf8").toString("base64url");

/** Read-only, keyset-paginated issue listing for integrations; the app itself reads from its local replica. */
export function issueRoutes(deps: { workspaces: WorkspaceRepository }): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const query = IssuesQuery.parse(req.query);
    const access = accessOf(res);
    const teamIds = query.teamId ? access.teamIds.filter((id) => id === query.teamId) : access.teamIds;
    const issues = await deps.workspaces.pageIssues({
      workspaceId: access.user.workspaceId,
      teamIds,
      limit: query.limit + 1,
      cursor: decodeCursor(query.cursor),
    });
    const page = issues.slice(0, query.limit);
    const last = page.at(-1);
    res.json({
      issues: page,
      nextCursor: issues.length > query.limit && last ? encodeCursor(last.updatedAt, last.id) : null,
    });
  });

  return router;
}
