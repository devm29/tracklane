import { DemoAccount, ErrorBody, LoginResponse } from "@tracklane/domain";
import { z } from "zod";
import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Can't reach the Tracklane server. Check that the API is running.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    throw new ApiError(response.status, parsed.success ? parsed.data.error.message : `Request failed (${response.status})`);
  }
  return schema.parse(body);
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return request("/api/auth/login", LoginResponse, { method: "POST", body: JSON.stringify({ email, password }) });
}

export async function fetchDemoAccounts(): Promise<DemoAccount[]> {
  const { accounts } = await request("/api/auth/demo-accounts", z.object({ accounts: z.array(DemoAccount) }));
  return accounts;
}
