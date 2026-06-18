import { defineConfig } from 'tsup';

/** Prod-сборка сервера (2.0.a). esbuild бандлит server/ (и позже core) в dist-server/. */
export default defineConfig({
  entry: ['server/index.ts'],
  outDir: 'dist-server',
  format: ['esm'],
  target: 'node20',
  clean: true,
});
