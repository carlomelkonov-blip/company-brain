import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Open http://acme.localhost:5173 — the subdomain selects the workspace.
// The proxy keeps the original Host header so the API can resolve the workspace from it.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: [".localhost"],
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
});
