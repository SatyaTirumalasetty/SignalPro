import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { federation } from '@module-federation/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      tailwindcss(),
      federation({
      name: 'shell',
      filename: 'remoteEntry.js',
      dts: false,
      remotes: {
        trading_remote: {
          type: 'module',
          name: 'trading_remote',
          entry: env.VITE_TRADING_REMOTE_URL || 'http://localhost:5174/remoteEntry.js',
          entryGlobalName: 'trading_remote',
          shareScope: 'default',
        },
        market_remote: {
          type: 'module',
          name: 'market_remote',
          entry: env.VITE_MARKET_REMOTE_URL || 'http://localhost:5175/remoteEntry.js',
          entryGlobalName: 'market_remote',
          shareScope: 'default',
        },
        admin_remote: {
          type: 'module',
          name: 'admin_remote',
          entry: env.VITE_ADMIN_REMOTE_URL || 'http://localhost:5176/remoteEntry.js',
          entryGlobalName: 'admin_remote',
          shareScope: 'default',
        },
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
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    server: {
      port: 5173,
      origin: 'http://localhost:5173',
    },
    preview: {
      port: 5173,
    },
    build: {
      target: 'esnext',
      modulePreload: false,
    },
  }
})
