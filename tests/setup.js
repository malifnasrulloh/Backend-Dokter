// Load .env for vitest (Bun loads .env automatically, Node/vitest doesn't)
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
