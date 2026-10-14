import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";

// The daemon serves dist/ from the installed checkout on 127.0.0.1:8327. In
// development, `pnpm dev` proxies /api to a running daemon on the same port.
export default defineConfig({
  base: "/",
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false },
  server: { port: 5327, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:8327", changeOrigin: true } } },
});
