import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/openwrite': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        timeout: 600000,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      '/plagiarism': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/plagiarism/, ''),
      },
    },
  }
});