import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/mcp": "http://localhost:3000",
      "/runs": "http://localhost:3000",
      "/conversations": "http://localhost:3000",
      "/static": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/mailgun": "http://localhost:3000",
    },
  },
});
