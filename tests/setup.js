// Load .env for vitest (Bun loads .env automatically, Node/vitest doesn't)
const dotenv = require('dotenv');
const path = require('node:path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Test-only fallback so the suite is hermetic in CI (no .env committed).
// Route modules must load without it (lazy secret middleware), but any
// test exercising JWT flows gets a deterministic key.
if (!process.env.SECRETTOKEN) {
  process.env.SECRETTOKEN = 'ci-test-secret-do-not-use-in-production';
}
