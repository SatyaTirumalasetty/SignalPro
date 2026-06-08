// Ambient declarations for Module Federation remotes consumed at runtime.
// Each entry mirrors the named export of the page component the remote exposes —
// see `exposes` in the corresponding remote's vite.config.ts.

declare module 'trading_remote/OrdersPage' {
  export const OrdersPage: React.ComponentType
}
declare module 'trading_remote/PositionsPage' {
  export const PositionsPage: React.ComponentType
}
declare module 'trading_remote/PortfolioPage' {
  export const PortfolioPage: React.ComponentType
}
declare module 'trading_remote/BrokersPage' {
  export const BrokersPage: React.ComponentType
}
declare module 'trading_remote/BrokerConnectedPage' {
  export const BrokerConnectedPage: React.ComponentType
}
declare module 'trading_remote/BillingPage' {
  export const BillingPage: React.ComponentType
}
declare module 'trading_remote/SettingsPage' {
  export const SettingsPage: React.ComponentType
}

declare module 'market_remote/MarketPage' {
  export const MarketPage: React.ComponentType
}
declare module 'market_remote/SignalsPage' {
  export const SignalsPage: React.ComponentType
}
declare module 'market_remote/SignalPerformancePage' {
  export const SignalPerformancePage: React.ComponentType
}

declare module 'admin_remote/AdminOverviewPage' {
  export const AdminOverviewPage: React.ComponentType
}
declare module 'admin_remote/AdminUsersPage' {
  export const AdminUsersPage: React.ComponentType
}
declare module 'admin_remote/AdminBillingPage' {
  export const AdminBillingPage: React.ComponentType
}
declare module 'admin_remote/AdminSignalsPage' {
  export const AdminSignalsPage: React.ComponentType
}
declare module 'admin_remote/AdminSupportPage' {
  export const AdminSupportPage: React.ComponentType
}
