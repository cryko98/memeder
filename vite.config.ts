import { defineConfig } from "vite";

// Minimal Vite config. The dev server proxies /api/* to a local handler is NOT
// set up here — during local dev the serverless function in api/tokens.ts is run
// by `vercel dev`. If you only run `vite`, see the README for the VITE_TOKENS_URL
// override so the client can hit a deployed /api/tokens endpoint instead.
export default defineConfig({
  build: {
    target: "es2020",
  },
});
