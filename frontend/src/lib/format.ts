export function formatCurrency(value: number | null | undefined, currency = 'USD') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
}

export function formatNumber(value: number | null | undefined, fractionDigits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: fractionDigits }).format(value)
}

export function formatPercent(value: number | string | null | undefined, fractionDigits = 1) {
  if (value === null || value === undefined) return '—'
  const num = typeof value === 'string' ? Number(value) : value
  if (Number.isNaN(num)) return '—'
  const normalized = Math.abs(num) <= 1 ? num * 100 : num
  return `${normalized.toFixed(fractionDigits)}%`
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export function signalBadgeVariant(signalType: string): 'success' | 'danger' | 'muted' {
  const normalized = signalType?.toLowerCase()
  if (normalized?.includes('buy') || normalized?.includes('long')) return 'success'
  if (normalized?.includes('sell') || normalized?.includes('short')) return 'danger'
  return 'muted'
}
