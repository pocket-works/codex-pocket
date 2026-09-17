import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: true },
  server: {
    // During development the host runs separately; proxy API + WS to it.
    proxy: {
      "/api": "http://127.0.0.1:7333",
      "/ws": { target: "ws://127.0.0.1:7333", ws: true },
    },
  },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
