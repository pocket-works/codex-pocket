import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { defineConfig, transformWithEsbuild, type Plugin } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

function appShellWorker(): Plugin {
  return {
    name: "app-shell-worker",
    apply: "build",
    generateBundle: {
      order: "post",
      async handler(_, bundle) {
        const assets = Object.keys(bundle).filter((name) => /\.(js|css|woff2)$/.test(name)).sort().map((name) => `/${name}`);
        const html = bundle["index.html"];
        if (!html || html.type !== "asset") throw new Error("App shell HTML is missing");
        const source = readFileSync(new URL("./src/sw.ts", import.meta.url), "utf8");
        const revision = createHash("sha256").update(html.source).update(source).update(JSON.stringify(assets)).digest("hex").slice(0, 16);
        const { code } = await transformWithEsbuild(source, "sw.ts", {
          minify: true,
          format: "iife",
          define: {
            __SHELL_VERSION__: JSON.stringify(revision),
            __SHELL_ASSETS__: JSON.stringify(["/", "/manifest.webmanifest", "/icon.svg?v=2", "/icon-180.png?v=2", "/icon-512.png", ...assets]),
          },
        });
        this.emitFile({ type: "asset", fileName: "shell-assets.json", source: JSON.stringify(assets) });
        this.emitFile({ type: "asset", fileName: "sw.js", source: code });
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), appShellWorker()],
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
