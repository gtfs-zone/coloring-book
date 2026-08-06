import type { KnipConfig } from "knip";

const config: KnipConfig = {
  tags: ["-lintignore"],
  entry: [
    "src/index.html",
    // Standalone scripts invoked directly (not imported by other modules)
    "scripts/**/*.ts",
  ],
  project: ["src/**/*.{ts,js}", "scripts/**/*.ts"],
  ignore: [
    // The spec-driven table component landed ahead of its first consumer.
    // Remove this entry when the fares modal is rebuilt on top of it.
    "src/modules/editable-table.ts",
  ],
  ignoreDependencies: [
    // Used in postcss.config.js as string plugin names, not ESM imports
    "@tailwindcss/postcss",
    "autoprefixer",
    // TypeScript compiler helpers: used implicitly by tsc with importHelpers
    "tslib",
    // @types/jszip augments the jszip package; no direct import needed
    "@types/jszip",
    // Used by @lhci/cli internally
    "lighthouse",
  ],
  ignoreBinaries: [
    "live-server", // invoked in serve script; not a direct package dep
    "rollup", // invoked in build:watch; not a direct package dep
    "cz", // commitizen CLI
  ],
  // Suppress noise from exports that are defined for internal cohesion
  // (e.g. helpers on the same module, types defined alongside their users).
  ignoreExportsUsedInFile: true,
};

export default config;
