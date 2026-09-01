import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  server: { host: "0.0.0.0", allowedHosts: true },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        game: resolve(process.cwd(), "game.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/three/")) return "three";
          return undefined;
        },
      },
    },
  },
});
