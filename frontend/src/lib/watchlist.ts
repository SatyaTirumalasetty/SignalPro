// Display-only company names for the curated seed. Membership itself is owned
// by the backend WATCHLIST_SEED; symbols added via search that aren't here
// simply render as their ticker.
export const SYMBOL_NAMES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', AMZN: 'Amazon', GOOGL: 'Alphabet',
  META: 'Meta Platforms', TSLA: 'Tesla', 'BRK.B': 'Berkshire Hathaway', JPM: 'JPMorgan Chase', V: 'Visa',
  UNH: 'UnitedHealth', XOM: 'Exxon Mobil', JNJ: 'Johnson & Johnson', WMT: 'Walmart', MA: 'Mastercard',
  PG: 'Procter & Gamble', HD: 'Home Depot', COST: 'Costco', ORCL: 'Oracle', NFLX: 'Netflix',
}
