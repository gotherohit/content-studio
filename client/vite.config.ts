import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/term": { target: "ws://localhost:4700", ws: true },
      "/api": "http://localhost:4700",
    },
  },
});
