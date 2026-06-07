import { type ReactNode } from 'react'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <h1 className="mb-1 text-xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mb-5 text-sm text-muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}
