import type { NextConfig } from "next";

const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110");
const socketUrl = `${apiUrl.protocol === "https:" ? "wss:" : "ws:"}//${apiUrl.host}`;
const dev = process.env.NODE_ENV !== "production";

/**
 * The session token lives in localStorage so the sync engine can hand it to
 * the socket, which makes script injection the threat that matters. Scripts
 * may only come from this origin (Next's inline bootstrap needs
 * 'unsafe-inline'; dev mode also needs eval for fast refresh), the page can
 * only talk to the API, and nothing may frame it.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiUrl.origin} ${socketUrl}${dev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const config: NextConfig = {
  reactStrictMode: true,
  // The Docker image runs the standalone server; local `next start` uses the regular build.
  ...(process.env.NEXT_STANDALONE === "1"
    ? { output: "standalone" as const, outputFileTracingRoot: new URL("../../", import.meta.url).pathname }
    : {}),
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
