import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 3000,
    proxy: {
      '/auth': { target: 'http://localhost:26100', changeOrigin: true },
      '/conversation': { target: 'http://localhost:26100', changeOrigin: true },
      '/llm': { target: 'http://localhost:26100', changeOrigin: true },
      '/api': { target: 'http://localhost:26100', changeOrigin: true },
      '/inbox': { target: 'http://localhost:26100', changeOrigin: true },
      '/events': { target: 'http://localhost:26100', changeOrigin: true },
      '/agent': { target: 'http://localhost:26100', changeOrigin: true },
    },
  },
});
