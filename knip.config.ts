import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "src/index.html",
    // Standalone scripts invoked directly (not imported by other modules)
    "scripts/**/*.ts",
  ],
  project: ["src/**/*.{ts,js,css}", "scripts/**/*.ts"],
  ignoreDependencies: [
    // TypeScript compiler helpers: used implicitly by tsc with importHelpers
    "tslib",
    // Provides the global GeoJSON namespace; used without an import
    "@types/geojson",
  ],
  ignoreBinaries: [
    "cz", // commitizen CLI
  ],
  // Suppress noise from exports that are defined for internal cohesion
  // (e.g. helpers on the same module, types defined alongside their users).
  ignoreExportsUsedInFile: true,
};

export default config;
