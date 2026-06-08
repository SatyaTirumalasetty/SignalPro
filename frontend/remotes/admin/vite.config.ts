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
      name: 'admin_remote',
      filename: 'remoteEntry.js',
      dts: false,
      exposes: {
        './AdminOverviewPage': './src/pages/admin/AdminOverviewPage.tsx',
        './AdminUsersPage': './src/pages/admin/AdminUsersPage.tsx',
        './AdminBillingPage': './src/pages/admin/AdminBillingPage.tsx',
        './AdminSignalsPage': './src/pages/admin/AdminSignalsPage.tsx',
        './AdminSupportPage': './src/pages/admin/AdminSupportPage.tsx',
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
      port: 5176,
      origin: 'http://localhost:5176',
    },
    preview: {
      port: 5176,
    },
    build: {
      target: 'esnext',
      modulePreload: false,
    },
  }
})
