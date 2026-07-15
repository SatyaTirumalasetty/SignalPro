import * as RadixTabs from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = RadixTabs.Root

export function TabsList({ className, ...props }: RadixTabs.TabsListProps) {
  return (
    <RadixTabs.List
      className={cn('inline-flex items-center gap-1 rounded-md border border-border bg-card/40 p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: RadixTabs.TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium text-muted transition-colors cursor-pointer touch-manipulation hover:text-foreground',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        'data-[state=active]:bg-primary/15 data-[state=active]:text-primary',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: RadixTabs.TabsContentProps) {
  return <RadixTabs.Content className={cn('mt-4', className)} {...props} />
}
