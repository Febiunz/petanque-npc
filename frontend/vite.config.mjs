import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom' },
  server: {
    proxy: {
  '/api': process.env.DEV_API_TARGET || 'http://localhost:5000'
    }
  }
});
