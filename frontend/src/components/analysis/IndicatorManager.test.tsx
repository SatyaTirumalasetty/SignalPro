import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { IndicatorManager } from './IndicatorManager'
import type { IndicatorConfig } from '@/lib/indicators/types'

const layout: IndicatorConfig[] = [
  { id: 'sma-20', kind: 'sma', params: { period: 20 }, visible: true },
  { id: 'rsi-14', kind: 'rsi', params: { period: 14 }, visible: false },
]

describe('IndicatorManager', () => {
  test('renders a chip per instance with visibility state', () => {
    render(<IndicatorManager value={layout} onChange={vi.fn()} />)
    expect(screen.getByText(/sma 20/i)).toBeInTheDocument()
    expect(screen.getByText(/rsi 14/i)).toBeInTheDocument()
  })

  test('clicking a chip toggles visibility', () => {
    const onChange = vi.fn()
    render(<IndicatorManager value={layout} onChange={onChange} />)
    fireEvent.click(screen.getByText(/sma 20/i))
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'sma-20', visible: false }),
      expect.objectContaining({ id: 'rsi-14' }),
    ])
  })

  test('remove button deletes the instance', () => {
    const onChange = vi.fn()
    render(<IndicatorManager value={layout} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'rsi-14' })])
  })

  test('add flow appends a new instance with chosen params', () => {
    const onChange = vi.fn()
    render(<IndicatorManager value={layout} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add indicator/i }))
    fireEvent.click(screen.getByRole('button', { name: /^ema$/i }))
    fireEvent.change(screen.getByLabelText(/period/i), { target: { value: '34' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    const next = onChange.mock.calls[0][0] as IndicatorConfig[]
    expect(next).toHaveLength(3)
    expect(next[2]).toMatchObject({ kind: 'ema', params: { period: 34 }, visible: true })
  })
})
