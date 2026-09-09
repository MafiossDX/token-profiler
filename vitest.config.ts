import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Component tests for the Preact UI client (ADR-0015). Core / CLI / proxy keep
// their `node --test` suite (`npm test`); this is a second runner scoped to
// `src/ui/client/`, wired for JSX + a jsdom DOM. `npm run check` runs both.
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    include: ['src/ui/client/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
    // Pinned so format.clock() has a stable, non-UTC expectation (ui-review §4).
    env: { TZ: 'America/New_York' },
  },
});
