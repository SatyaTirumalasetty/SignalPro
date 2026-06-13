import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function Select({ value, onValueChange, options, placeholder, className, disabled }: SelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown size={16} className="text-muted" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-md border border-border bg-card shadow-lg"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt.value}
                value={opt.value}
                className="relative flex cursor-pointer select-none items-center rounded-sm px-3 py-2 pl-8 text-sm text-foreground outline-none data-[highlighted]:bg-primary/15 data-[highlighted]:text-primary"
              >
                <RadixSelect.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <Check size={14} />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
