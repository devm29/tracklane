import type { Response } from "express";
import { unauthorized } from "../errors.js";
import type { AccessContext } from "../services/access.service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      access?: AccessContext;
    }
  }
}

export function accessOf(res: Response): AccessContext {
  const access = res.locals.access;
  if (!access) throw unauthorized();
  return access;
}
