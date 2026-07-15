import { describe, test, expect } from 'vitest'
import { orderBySeedRank } from './watchlist'

describe('orderBySeedRank', () => {
  test('sorts seed symbols into their canonical slot regardless of input order', () => {
    expect(orderBySeedRank(['NVDA', 'AAPL', 'MSFT'])).toEqual(['AAPL', 'MSFT', 'NVDA'])
  })

  test('a re-added seed symbol returns to its original position, not the end', () => {
    // AAPL (rank 0) removed then re-added lands back at the front, not after NVDA.
    expect(orderBySeedRank(['MSFT', 'NVDA', 'AAPL'])).toEqual(['AAPL', 'MSFT', 'NVDA'])
  })

  test('keeps non-seed symbols after the seed block in their relative order', () => {
    expect(orderBySeedRank(['PLTR', 'MSFT', 'SNOW', 'AAPL'])).toEqual(['AAPL', 'MSFT', 'PLTR', 'SNOW'])
  })

  test('is idempotent', () => {
    const once = orderBySeedRank(['NVDA', 'PLTR', 'AAPL'])
    expect(orderBySeedRank(once)).toEqual(once)
  })

  test('handles empty and all-non-seed lists', () => {
    expect(orderBySeedRank([])).toEqual([])
    expect(orderBySeedRank(['PLTR', 'SNOW'])).toEqual(['PLTR', 'SNOW'])
  })
})
