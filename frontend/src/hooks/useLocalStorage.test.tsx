import { renderHook, act } from '@testing-library/react'
import { describe, test, expect, beforeEach } from 'vitest'
import { useLocalStorage } from './useLocalStorage'

describe('useLocalStorage', () => {
  beforeEach(() => localStorage.clear())

  test('returns null when the key is unset', () => {
    const { result } = renderHook(() => useLocalStorage('k'))
    expect(result.current[0]).toBeNull()
  })

  test('reads an existing value on mount', () => {
    localStorage.setItem('k', 'x')
    const { result } = renderHook(() => useLocalStorage('k'))
    expect(result.current[0]).toBe('x')
  })

  test('persists a value and updates state', () => {
    const { result } = renderHook(() => useLocalStorage('k'))
    act(() => result.current[1]('1'))
    expect(result.current[0]).toBe('1')
    expect(localStorage.getItem('k')).toBe('1')
  })

  test('removes the key when set to null', () => {
    localStorage.setItem('k', '1')
    const { result } = renderHook(() => useLocalStorage('k'))
    act(() => result.current[1](null))
    expect(result.current[0]).toBeNull()
    expect(localStorage.getItem('k')).toBeNull()
  })
})
