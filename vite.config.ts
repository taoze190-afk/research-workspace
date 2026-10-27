import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/**
 * 本地把 /api 转给自建服务端，等价于线上 1Panel 的 Nginx 反代。
 * 服务端没起来时 vite 返回 500，前端 detectMode() 会因此退回纯本地模式。
 */
const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:8787';
const proxy = { '/api': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy,
    watch: {
      ignored: ['**/tools/**', '**/shots/**', '**/test-results/**', '**/server/data/**'],
    },
  },
  preview: { port: 4173, proxy },
});
