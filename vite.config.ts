/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Registered manually in main.tsx, and only when mocks are off: MSW's
      // worker and the app's worker cannot share the same scope.
      injectRegister: false,
      registerType: 'prompt',
      pwaAssets: { config: true },
      manifest: {
        name: 'EMS Field',
        short_name: 'EMS Field',
        description: 'EMS Field by Entacrest: record loan repayments and thrift collections in the field.',
        id: '/field/',
        start_url: '/field/today',
        scope: '/field/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#15201B',
        background_color: '#FFFFFF',
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['mockServiceWorker.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Framework code changes rarely; keep it in its own long-cached chunk.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@tanstack/react-query', 'react-hook-form', '@hookform/resolvers', 'zod', 'idb'],
        },
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The mock database reset is slow when every file runs in parallel.
    testTimeout: 20_000,
    env: {
      VITE_API_BASE_URL: 'http://localhost:3000/api/v1',
      VITE_USE_MOCKS: 'true',
    },
  },
})
