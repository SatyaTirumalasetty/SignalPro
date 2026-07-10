// Mirrors backend riskManagement.calculatePositionSize so the ticket's
// pre-filled quantity matches what the engine would size.
export function sizeByRisk({ equity, riskPct, entry, stop }: { equity: number; riskPct: number; entry: number; stop: number }): number {
  if (!equity || equity <= 0 || !entry || entry <= 0) return 0
  const perUnit = Math.abs(entry - stop)
  if (!perUnit) return 0
  const riskQty = Math.floor((equity * riskPct) / perUnit)
  const affordableQty = Math.floor(equity / entry)
  return Math.max(0, Math.min(riskQty, affordableQty))
}
