import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1", // the dev server is for this machine only

    proxy: {
      "/api/term": { target: "ws://127.0.0.1:4700", ws: true },
      "/api": "http://127.0.0.1:4700",
    },
  },
});
