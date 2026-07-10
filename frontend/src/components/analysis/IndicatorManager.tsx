import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type IndicatorConfig, type IndicatorKind, DEFAULT_PARAMS } from '@/lib/indicators/types'

const ALL_KINDS: IndicatorKind[] = ['sma', 'ema', 'wma', 'bollinger', 'vwap', 'keltner', 'psar', 'supertrend', 'rsi', 'macd', 'stochastic', 'atr', 'obv']

function chipLabel(cfg: IndicatorConfig) {
  const params = Object.values(cfg.params).join('/')
  return params ? `${cfg.kind.toUpperCase()} ${params}` : cfg.kind.toUpperCase()
}

export function IndicatorManager({ value, onChange }: { value: IndicatorConfig[]; onChange: (v: IndicatorConfig[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<IndicatorKind | null>(null)
  const [params, setParams] = useState<Record<string, number>>({})

  const toggle = (id: string) =>
    onChange(value.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)))
  const remove = (id: string) => onChange(value.filter((c) => c.id !== id))

  const startAdd = (k: IndicatorKind) => {
    setKind(k)
    setParams({ ...DEFAULT_PARAMS[k] })
  }
  const confirmAdd = () => {
    if (!kind) return
    const id = `${kind}-${Date.now().toString(36)}`
    onChange([...value, { id, kind, params, visible: true }])
    setAdding(false)
    setKind(null)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((cfg) => (
        <span
          key={cfg.id}
          className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
            cfg.visible ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-card text-muted'
          }`}
        >
          <button type="button" onClick={() => toggle(cfg.id)}>{chipLabel(cfg)}</button>
          <button type="button" aria-label={`remove ${chipLabel(cfg)}`} onClick={() => remove(cfg.id)} className="hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {!adding && (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
          + Add indicator
        </Button>
      )}

      {adding && !kind && (
        <span className="flex flex-wrap gap-1">
          {ALL_KINDS.map((k) => (
            <Button key={k} type="button" size="sm" variant="outline" onClick={() => startAdd(k)}>
              {k}
            </Button>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>cancel</Button>
        </span>
      )}

      {adding && kind && (
        <span className="flex items-center gap-1">
          {Object.entries(params).map(([name, val]) => (
            <label key={name} className="flex items-center gap-1 text-xs text-muted">
              {name}
              <Input
                aria-label={name}
                type="number"
                step="any"
                value={val}
                onChange={(e) => setParams((p) => ({ ...p, [name]: Number(e.target.value) }))}
                className="h-7 w-16"
              />
            </label>
          ))}
          <Button type="button" size="sm" onClick={confirmAdd}>Add</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setAdding(false); setKind(null) }}>cancel</Button>
        </span>
      )}
    </div>
  )
}
