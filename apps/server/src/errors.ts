export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (message = "Sign in to continue"): AppError => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to this resource"): AppError => new AppError(403, "forbidden", message);
export const notFound = (message = "Not found"): AppError => new AppError(404, "not_found", message);
export const tooManyRequests = (retryAfterMs: number): AppError =>
  new AppError(429, "rate_limited", "Too many attempts. Try again in a moment.", { retryAfterMs });
export const badRequest = (message: string, details?: unknown): AppError => new AppError(400, "bad_request", message, details);

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

/** Fields of the unique index a duplicate-key error tripped over, e.g. ["_id"] or ["workspaceId", "clientTxId"]. */
export function duplicateKeyFields(error: unknown): string[] {
  if (!isDuplicateKeyError(error) || typeof error !== "object" || error === null) return [];
  const pattern = "keyPattern" in error ? error.keyPattern : undefined;
  return typeof pattern === "object" && pattern !== null ? Object.keys(pattern) : [];
}
