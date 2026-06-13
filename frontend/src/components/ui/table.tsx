import { type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  )
}

interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> {
  sticky?: boolean
}

export function TableHeader({ className, sticky, ...props }: TableHeaderProps) {
  return (
    <thead
      className={cn(
        'border-b border-border text-xs uppercase text-muted',
        sticky && 'sticky top-0 z-10 bg-card',
        className,
      )}
      {...props}
    />
  )
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-card/60', className)} {...props} />
}

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  sortDirection?: 'asc' | 'desc' | null
  onSort?: () => void
}

export function TableHead({ className, sortDirection, onSort, children, ...props }: TableHeadProps) {
  if (!onSort) {
    return <th className={cn('px-3 py-2 font-medium', className)} {...props}>{children}</th>
  }

  const Icon = sortDirection === 'asc' ? ArrowUp : sortDirection === 'desc' ? ArrowDown : ArrowUpDown

  return (
    <th className={cn('px-3 py-2 font-medium', className)} {...props}>
      <button
        type="button"
        onClick={onSort}
        className="flex items-center gap-1 cursor-pointer select-none hover:text-foreground"
      >
        {children}
        <Icon size={12} className={sortDirection ? 'text-foreground' : 'text-muted'} />
      </button>
    </th>
  )
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2', className)} {...props} />
}
