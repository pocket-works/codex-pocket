import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react(), {
    name: "pocket-shell-cache",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter((name) => /\.(js|css|woff2)$/.test(name)).map((name) => `/${name}`);
      const revision = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "shell-assets.json", source: JSON.stringify(assets) });
      this.emitFile({ type: "asset", fileName: "sw.js", source: readFileSync(new URL("./public/sw.js", import.meta.url), "utf8").replace("codex-pocket-shell-v3", `codex-pocket-shell-v3-${revision}`) });
    },
  }],
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(process.env.VITE_APP_VERSION || version) },
  build: {
    outDir: "dist", sourcemap: true,
    rollupOptions: {
      input: { main: new URL("./index.html", import.meta.url).pathname, "push-worker": new URL("./src/push-worker.ts", import.meta.url).pathname },
      output: { entryFileNames: (chunk) => chunk.name === "push-worker" ? "push-worker.js" : "assets/index-[hash].js" },
    },
  },
  server: {
    // During development the host runs separately; proxy API + WS to it.
    proxy: {
      "/api": "http://127.0.0.1:7333",
      "/ws": { target: "ws://127.0.0.1:7333", ws: true },
    },
  },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
