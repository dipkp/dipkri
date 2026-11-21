import { loadEnvFile } from "node:process";
import fs from "node:fs";

try {
  loadEnvFile();
} catch (e) {
  console.log(e);
}

export default {
  build: {
    outDir: "build",
    // sourcemap: true,
  },
  server: {
    https:
      process.env.SSL_CRT_FILE && process.env.SSL_KEY_FILE
        ? {
            key: fs.readFileSync(process.env.SSL_KEY_FILE),
            cert: fs.readFileSync(process.env.SSL_CRT_FILE),
          }
        : null,
    allowedHosts: true,
    proxy: {
      // Dev UI runs on :5173, backend on :8080. Without this, relative
      // /api/movies/* calls hit Vite's SPA fallback and return HTML.
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
};
