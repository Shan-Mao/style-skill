import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri 桌面开发模式要求 devUrl 端口稳定（CLI 注入 TAURI_ENV）；
  // 普通 Web 开发模式不受影响
  ...(process.env.TAURI_ENV ? { server: { port: 5173, strictPort: true } } : {}),
})
