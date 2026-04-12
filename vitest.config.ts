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
      reporter: ["text", "html", "json-summary"],
      // The `include` glob forces v8 to measure every matching file in
      // the denominator, even ones no test happens to import. Without
      // this, untested modules are silently dropped and the percentage
      // is inflated.
      include: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
      exclude: [
        // Test infra
        "test/**",
        "**/*.d.ts",
        "**/*.config.*",
        // Next.js App Router boilerplate — composition of already-tested
        // hooks and components; unit-testing them needs so much mocking
        // that a Playwright E2E would pay off more.
        "app/**/page.tsx",
        "app/**/layout.tsx",
        "app/**/loading.tsx",
        "app/**/error.tsx",
        "app/**/not-found.tsx",
        "app/**/global-error.tsx",
        // shadcn/ui primitives are generated wrappers; upstream tests them.
        "components/ui/**",
        // Interactive modal + client-layout: composition of hooks behind a
        // fullscreen overlay; meaningful coverage needs a browser (Playwright).
        "components/first-sync-modal.tsx",
        "app/client-layout.tsx",
        // shadcn's toast hook is copied from the CLI template, not original code.
        "hooks/use-toast.ts",
        // Type-only / re-export barrels
        "lib/types/**",
        "lib/server/steam-store.ts",
      ],
      // Baseline thresholds locked to the current honest numbers. Each
      // coverage PR ratchets these up; CI fails if a PR regresses below
      // the current floor.
      thresholds: {
        lines: 92,
        statements: 90,
        branches: 83,
        functions: 81,
      },
    },
  },
  resolve: {
    alias: {
      "@": rootDir,
      "server-only": path.join(rootDir, "test/server-only-stub.ts"),
    },
  },
})
