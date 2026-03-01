import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/ai-town',
  plugins: [react()],
  test: {
    globals: true,
    exclude: ['.worktrees/**', 'node_modules/**'],
  },
  server: {
    host: '0.0.0.0',
    hmr: {
      host: process.env.VITE_HOST,
    },
    allowedHosts: ['ai-town-your-app-name.fly.dev', 'localhost', '127.0.0.1', 'evans-pc'],
  },
});
