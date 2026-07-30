import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  base: "/stock/",
  server: {
    proxy: {
      "/stock-api": {
        target: "http://127.0.0.1:8002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stock-api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/testSetup.ts",
  },
});
