import { type ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-elevated p-5 shadow-2xl shadow-black/50 outline-none',
            className,
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <RadixDialog.Title className="text-base font-semibold text-foreground">{title}</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="Close"
              className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-card hover:text-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={18} />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
