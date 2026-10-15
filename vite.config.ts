/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the build works on any GitHub Pages project URL (/<repo>/).
  base: './',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
