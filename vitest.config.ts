import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import path from "node:path"

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": rootDir,
      "server-only": path.join(rootDir, "test/server-only-stub.ts"),
    },
  },
})
