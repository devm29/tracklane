import { Router } from "express";
import { SyncEpoch } from "@tracklane/domain";
import { z } from "zod";
import type { BootstrapService } from "../../services/bootstrap.service.js";
import type { CatchUpService } from "../../services/catch-up.service.js";
import { accessOf } from "../context.js";

const DeltasQuery = z.object({ after: z.coerce.number().int().nonnegative(), epoch: SyncEpoch });

export function syncRoutes(deps: { bootstrap: BootstrapService; catchUp: CatchUpService }): Router {
  const router = Router();

  router.get("/bootstrap", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await deps.bootstrap.bootstrap(accessOf(res)));
  });

  // HTTP fallback for the socket catch-up, handy for debugging with curl.
  router.get("/deltas", async (req, res) => {
    const { after, epoch } = DeltasQuery.parse(req.query);
    const access = accessOf(res);
    res.json(await deps.catchUp.catchUp(access.user.workspaceId, access.teamIds, after, epoch));
  });

  return router;
}
