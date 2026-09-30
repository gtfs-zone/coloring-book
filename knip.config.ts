import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "src/index.html",
    // Standalone scripts invoked directly (not imported by other modules)
    "scripts/**/*.ts",
  ],
  project: ["src/**/*.{ts,js}", "scripts/**/*.ts"],
  ignoreDependencies: [
    // Used in postcss.config.js as string plugin names, not ESM imports
    "@tailwindcss/postcss",
    "autoprefixer",
    // Referenced from src/styles/main.css (`@import 'tailwindcss'`, `@plugin "daisyui"`),
    // which knip does not read
    "tailwindcss",
    "daisyui",
    // TypeScript compiler helpers: used implicitly by tsc with importHelpers
    "tslib",
  ],
  ignoreBinaries: [
    "cz", // commitizen CLI
  ],
  // Suppress noise from exports that are defined for internal cohesion
  // (e.g. helpers on the same module, types defined alongside their users).
  ignoreExportsUsedInFile: true,
};

export default config;
