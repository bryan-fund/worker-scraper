import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0', // Bind to all network interfaces
    port: 5173,      // Default Vite port
    strictPort: false // Allow port to change if 5173 is busy
  }
})