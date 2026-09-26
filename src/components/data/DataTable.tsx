import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/states'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { Pagination, type PaginationProps } from './Pagination'

export interface Column<T> {
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Numbers and money are right-aligned. */
  align?: 'left' | 'right'
  /** DRF ordering field; makes the header sortable. */
  sortKey?: string
  className?: string
  headerClassName?: string
}

export interface DataTableProps<T> {
  /** Accessible name for the table, e.g. "Customers". */
  caption: string
  columns: Column<T>[]
  rows: T[] | undefined
  getRowId: (row: T) => string
  isLoading?: boolean
  /** True while a new page loads over existing rows. */
  isFetching?: boolean
  error?: unknown
  onRetry?: () => void
  empty: { title: string; description?: ReactNode; action?: ReactNode }
  /** DRF ordering value, e.g. "-created_at". */
  ordering?: string
  onOrderingChange?: (ordering: string | undefined) => void
  pagination?: PaginationProps
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void }
  /** Rendered in the bar that appears when rows are selected. */
  bulkActions?: (selectedIds: string[]) => ReactNode
  onRowClick?: (row: T) => void
  density?: 'compact' | 'comfortable'
  /** Height of the scroll area; the header stays pinned inside it. */
  maxHeight?: string
  toolbar?: ReactNode
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  ordering,
  onOrderingChange,
  pagination,
  selection,
  bulkActions,
  onRowClick,
  density = 'compact',
  maxHeight = 'calc(100dvh - 18rem)',
  toolbar,
}: DataTableProps<T>) {
  const rowHeight = density === 'compact' ? 'h-9' : 'h-11'
  const pageIds = rows?.map(getRowId) ?? []
  const selectedOnPage = selection ? pageIds.filter((id) => selection.selected.has(id)) : []
  const allSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length
  const someSelected = selectedOnPage.length > 0 && !allSelected
  const headerCheckbox = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected
  }, [someSelected])

  const toggleAll = () => {
    if (!selection) return
    const next = new Set(selection.selected)
    if (allSelected) pageIds.forEach((id) => next.delete(id))
    else pageIds.forEach((id) => next.add(id))
    selection.onChange(next)
  }

  const toggleRow = (id: string) => {
    if (!selection) return
    const next = new Set(selection.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selection.onChange(next)
  }

  const sortFor = (key: string) => {
    if (ordering === key) return 'ascending'
    if (ordering === `-${key}`) return 'descending'
    return 'none'
  }

  const cycleSort = (key: string) => {
    const current = sortFor(key)
    onOrderingChange?.(current === 'none' ? key : current === 'ascending' ? `-${key}` : undefined)
  }

  const colCount = columns.length + (selection ? 1 : 0)
  const selectedCount = selection?.selected.size ?? 0

  let body: ReactNode
  if (error) {
    body = (
      <tr>
        <td colSpan={colCount}>
          <ErrorState error={error} onRetry={onRetry} />
        </td>
      </tr>
    )
  } else if (isLoading || !rows) {
    body = Array.from({ length: 8 }, (_, i) => (
      <tr key={i} className={cn(rowHeight, 'border-rule border-b')}>
        {Array.from({ length: colCount }, (_, j) => (
          <td key={j} className="px-3">
            <span className="bg-ink-tint block h-3 w-3/4 animate-pulse rounded-sm" />
          </td>
        ))}
      </tr>
    ))
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={colCount}>
          <EmptyState {...empty} />
        </td>
      </tr>
    )
  } else {
    body = rows.map((row) => {
      const id = getRowId(row)
      const selected = selection?.selected.has(id) ?? false
      return (
        <tr
          key={id}
          aria-selected={selection ? selected : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={
            onRowClick
              ? (e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row)
                }
              : undefined
          }
          className={cn(
            rowHeight,
            'border-rule border-b last:border-b-0',
            selected ? 'bg-ledger-tint' : 'hover:bg-paper',
            onRowClick && 'cursor-pointer focus-visible:-outline-offset-2',
          )}
        >
          {selection && (
            <td className="w-10 px-3" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className="accent-ledger size-4"
                checked={selected}
                onChange={() => toggleRow(id)}
                aria-label={`Select row ${id}`}
              />
            </td>
          )}
          {columns.map((col) => (
            <td
              key={col.id}
              className={cn(
                'text-ink px-3 text-sm whitespace-nowrap',
                col.align === 'right' && 'tabular text-right',
                col.className,
              )}
            >
              {col.cell(row)}
            </td>
          ))}
        </tr>
      )
    })
  }

  return (
    <div className="border-rule bg-surface rounded border">
      {toolbar && <div className="border-rule border-b px-3 py-2">{toolbar}</div>}
      {selection && selectedCount > 0 && (
        <div className="border-rule bg-ledger-tint flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
          <span className="font-medium">{selectedCount} selected</span>
          {bulkActions?.([...selection.selected])}
          <button
            type="button"
            className="text-ink ml-auto text-sm font-medium underline"
            onClick={() => selection.onChange(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}
      <div className="relative overflow-auto" style={{ maxHeight }}>
        <table
          className="w-full border-collapse text-left"
          aria-busy={isLoading || isFetching || undefined}
        >
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface sticky top-0 z-10 shadow-[inset_0_-1px_0_var(--color-rule-strong)]">
            <tr className="h-9">
              {selection && (
                <th scope="col" className="w-10 px-3">
                  <input
                    ref={headerCheckbox}
                    type="checkbox"
                    className="accent-ledger size-4"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows on this page"
                  />
                </th>
              )}
              {columns.map((col) => {
                const sort = col.sortKey ? sortFor(col.sortKey) : undefined
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={sort}
                    className={cn(
                      'text-ink-2 px-3 text-xs font-semibold whitespace-nowrap',
                      col.align === 'right' && 'text-right',
                      col.headerClassName,
                    )}
                  >
                    {col.sortKey && onOrderingChange ? (
                      <button
                        type="button"
                        onClick={() => cycleSort(col.sortKey!)}
                        className={cn(
                          'hover:text-ink inline-flex items-center gap-1 rounded-sm',
                          col.align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {col.header}
                        {sort === 'ascending' ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : sort === 'descending' ? (
                          <ArrowDown className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className={cn(isFetching && !isLoading && 'opacity-60')}>{body}</tbody>
        </table>
        {isFetching && !isLoading && (
          <div className="absolute top-2 right-3 z-20" role="status">
            <Spinner label="Updating" />
          </div>
        )}
      </div>
      {pagination && rows && rows.length > 0 && <Pagination {...pagination} />}
    </div>
  )
}
