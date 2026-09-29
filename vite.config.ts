import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Requests to /api go to the local server (server/index.mjs).
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
