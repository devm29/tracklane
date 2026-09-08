import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["lib/**/*.test.ts", "lib/**/*.test.tsx"],
    environment: "happy-dom",
  },
});
