// Display-only company names for the curated seed. Membership itself is owned
// by the backend WATCHLIST_SEED; symbols added via search that aren't here
// simply render as their ticker.
export const SYMBOL_NAMES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', AMZN: 'Amazon', GOOGL: 'Alphabet',
  META: 'Meta Platforms', TSLA: 'Tesla', 'BRK.B': 'Berkshire Hathaway', JPM: 'JPMorgan Chase', V: 'Visa',
  UNH: 'UnitedHealth', XOM: 'Exxon Mobil', JNJ: 'Johnson & Johnson', WMT: 'Walmart', MA: 'Mastercard',
  PG: 'Procter & Gamble', HD: 'Home Depot', COST: 'Costco', ORCL: 'Oracle', NFLX: 'Netflix',
}

// Seed rank = a symbol's position in the curated list. SYMBOL_NAMES is kept in
// the exact order of the backend WATCHLIST_SEED, so its key order defines the rank.
const SEED_RANK = new Map(Object.keys(SYMBOL_NAMES).map((sym, i) => [sym, i]))

// Canonical watchlist ordering: curated seed symbols first, always in their seed
// slot (so removing then re-adding one returns it to its original position),
// followed by any non-seed symbols (added via search) in their existing relative
// order. Pure and order-independent of the input, so it can be applied on every read.
export function orderBySeedRank(symbols: string[]): string[] {
  const seed = symbols
    .filter((s) => SEED_RANK.has(s))
    .sort((a, b) => SEED_RANK.get(a)! - SEED_RANK.get(b)!)
  const rest = symbols.filter((s) => !SEED_RANK.has(s))
  return [...seed, ...rest]
}
