import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src")
    }
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json", "html"],
      include: [
        "src/features/**/*.ts",
        "src/worker/**/*.ts",
        "src/integrations/**/*.ts"
      ]
    }
  }
});
