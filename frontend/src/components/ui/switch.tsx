import * as RadixSwitch from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function Switch({ checked, onCheckedChange, disabled, className }: SwitchProps) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative h-6 w-11 shrink-0 cursor-pointer rounded-full border border-border bg-card transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'data-[state=checked]:bg-primary data-[state=checked]:border-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <RadixSwitch.Thumb className="block h-4 w-4 translate-x-1 rounded-full bg-foreground transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-primary-foreground" />
    </RadixSwitch.Root>
  )
}
