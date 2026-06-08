import { useCallback, useState, type ReactNode } from 'react'
import { cn } from '@shared/lib/utils'
import { ToastContext } from '@shared/contexts/toast-context'

interface Toast {
  id: number
  message: string
  variant: 'default' | 'success' | 'error'
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, variant: Toast['variant'] = 'default') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, variant }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'rounded-md border px-4 py-2 text-sm shadow-lg',
              t.variant === 'success' && 'border-success/40 bg-success/10 text-success',
              t.variant === 'error' && 'border-danger/40 bg-danger/10 text-danger',
              t.variant === 'default' && 'border-border bg-card text-foreground',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
