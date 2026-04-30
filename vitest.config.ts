import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // 'server-only' is a Next.js package that throws at runtime in non-server
      // contexts. Mock it as a no-op so test files that import server routes work.
      "server-only": new URL(
        "./tests/__mocks__/server-only.ts",
        import.meta.url,
      ).pathname,
    },
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});
