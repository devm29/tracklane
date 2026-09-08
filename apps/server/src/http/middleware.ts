import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { AppError, notFound, unauthorized } from "../errors.js";
import type { Logger } from "../logger.js";
import type { AccessService } from "../services/access.service.js";
import type { AuthService } from "../services/auth.service.js";

export function requireAuth(auth: AuthService, access: AccessService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    const user = await auth.authenticate(header.slice("Bearer ".length));
    res.locals.access = await access.contextFor(user);
    next();
  };
}

export const notFoundHandler: RequestHandler = (req) => {
  throw notFound(`No route for ${req.method} ${req.path}`);
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: { code: "bad_request", message: "Request validation failed", details: z.flattenError(error) },
      });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: { code: "bad_request", message: "Malformed JSON body" } });
      return;
    }
    logger.error({ err: error, method: req.method, path: req.path }, "unhandled request error");
    res.status(500).json({ error: { code: "internal", message: "Something went wrong on our side" } });
  };
}
