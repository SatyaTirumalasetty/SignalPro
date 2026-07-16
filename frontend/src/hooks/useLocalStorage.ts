import { useCallback, useState } from 'react'

/**
 * Persist a single string flag in localStorage. Reads and writes are guarded so
 * a disabled/quota-exceeded localStorage (private mode) degrades to in-memory state.
 * Pass `null` to the setter to remove the key.
 */
export function useLocalStorage(key: string): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  })

  const set = useCallback(
    (next: string | null) => {
      setValue(next)
      try {
        if (next === null) localStorage.removeItem(key)
        else localStorage.setItem(key, next)
      } catch {
        // ignore write failures (private mode / quota)
      }
    },
    [key],
  )

  return [value, set]
}
