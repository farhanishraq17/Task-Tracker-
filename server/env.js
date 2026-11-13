// Loads .env (if present) before any other module reads process.env.
// Its own module so ESM import ordering guarantees it runs first (see index.js).
try { process.loadEnvFile(); } catch { /* no .env file: optional integrations simply stay disabled */ }
