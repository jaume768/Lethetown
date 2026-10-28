import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVER = `http://127.0.0.1:${process.env.PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  // Phaser ocupa ~1.2 MB minificado; no merece la pena trocearlo aún.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: {
      "/api": SERVER,
      "/ws": { target: SERVER, ws: true },
    },
  },
});
