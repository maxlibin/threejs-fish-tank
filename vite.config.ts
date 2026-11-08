import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/living-room-fish-tank/',
  build: { target: 'esnext' },
  server: { port: 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'] },
});
