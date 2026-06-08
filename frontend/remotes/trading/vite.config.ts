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
      name: 'trading_remote',
      filename: 'remoteEntry.js',
      dts: false,
      exposes: {
        './OrdersPage': './src/pages/trading/OrdersPage.tsx',
        './PositionsPage': './src/pages/trading/PositionsPage.tsx',
        './PortfolioPage': './src/pages/trading/PortfolioPage.tsx',
        './BrokersPage': './src/pages/brokers/BrokersPage.tsx',
        './BrokerConnectedPage': './src/pages/brokers/BrokerConnectedPage.tsx',
        './BillingPage': './src/pages/billing/BillingPage.tsx',
        './SettingsPage': './src/pages/settings/SettingsPage.tsx',
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
      port: 5174,
      origin: 'http://localhost:5174',
    },
    preview: {
      port: 5174,
    },
    build: {
      target: 'esnext',
      modulePreload: false,
    },
  }
})
