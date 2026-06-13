import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = RadixDropdown.Root
export const DropdownMenuTrigger = RadixDropdown.Trigger

export function DropdownMenuContent({ className, ...props }: RadixDropdown.DropdownMenuContentProps) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        sideOffset={6}
        align="end"
        className={cn(
          'z-50 min-w-[10rem] rounded-md border border-border bg-card p-1 shadow-lg',
          className,
        )}
        {...props}
      />
    </RadixDropdown.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: RadixDropdown.DropdownMenuItemProps) {
  return (
    <RadixDropdown.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-sm px-3 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-primary/15 data-[highlighted]:text-primary',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuLabel({ className, ...props }: RadixDropdown.DropdownMenuLabelProps) {
  return <RadixDropdown.Label className={cn('px-3 py-2 text-xs text-muted', className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }: RadixDropdown.DropdownMenuSeparatorProps) {
  return <RadixDropdown.Separator className={cn('my-1 h-px bg-border', className)} {...props} />
}
