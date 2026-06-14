import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './dropdown-menu'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table'
import { Dialog } from './dialog'

describe('Tabs', () => {
  test('switches content when a different tab is selected', async () => {
    const user = userEvent.setup()
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="two">Second panel</TabsContent>
      </Tabs>,
    )

    expect(screen.getByText('First panel')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Two' }))
    expect(await screen.findByText('Second panel')).toBeVisible()
  })
})

describe('DropdownMenu', () => {
  test('opens and shows items, label, and separator', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onSelect}>Edit</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(await screen.findByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})

describe('Table sortable header', () => {
  test('renders a sort button and calls onSort when clicked', () => {
    const onSort = vi.fn()
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead onSort={onSort} sortDirection="asc">Name</TableHead>
            <TableHead onSort={onSort} sortDirection={null}>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
            <TableCell>1</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    const button = screen.getByRole('button', { name: 'Name' })
    fireEvent.click(button)
    expect(onSort).toHaveBeenCalledTimes(1)
  })
})

describe('Dialog', () => {
  test('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="Example">
        <p>Body</p>
      </Dialog>,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(onClose).toHaveBeenCalled()
  })
})
