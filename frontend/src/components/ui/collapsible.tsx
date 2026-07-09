import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export function Collapsible({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="mt-1.5 rounded-md border border-border bg-card/50 p-2.5 text-xs leading-relaxed text-muted">
        {children}
      </div>
    </details>
  )
}
