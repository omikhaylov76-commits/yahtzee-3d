import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // DEV: публичный список столов (2.5.d) — HTTP на сервер платформы (:3001). Прокси держит запрос
  // same-origin для браузера (без CORS); в проде клиент раздаётся тем же сервером (same-origin).
  server: {
    proxy: {
      '/tables': 'http://localhost:3001',
    },
  },
});
