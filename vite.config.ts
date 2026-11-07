import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173 },
  build: {
    // The Milkdrop presets chunk is large but only loads when visuals are shown.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
