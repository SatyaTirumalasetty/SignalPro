import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { federation } from '@module-federation/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(() => {

  return {
    plugins: [
      react(),
      tailwindcss(),
      federation({
      name: 'market_remote',
      filename: 'remoteEntry.js',
      dts: false,
      exposes: {
        './MarketPage': './src/pages/market/MarketPage.tsx',
        './SignalsPage': './src/pages/signals/SignalsPage.tsx',
        './SignalPerformancePage': './src/pages/signals/SignalPerformancePage.tsx',
      },
      shared: {
      react: { singleton: true, requiredVersion: '^19.2.6' },
      'react-dom': { singleton: true, requiredVersion: '^19.2.6' },
      'react-router-dom': { singleton: true, requiredVersion: '^7.17.0' },
      '@tanstack/react-query': { singleton: true, requiredVersion: '^5.101.0' },
    },
    }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, '../../shared'),
      },
    },
    server: {
      port: 5175,
      origin: 'http://localhost:5175',
    },
    preview: {
      port: 5175,
    },
    build: {
      target: 'esnext',
      modulePreload: false,
    },
  }
})
