import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export interface PaginationProps {
  page: number
  pageSize: number
  count: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizes?: readonly number[]
}

const fmt = new Intl.NumberFormat('en-NG')

export function Pagination({
  page,
  pageSize,
  count,
  onPageChange,
  onPageSizeChange,
  pageSizes = [25, 50, 100],
}: PaginationProps) {
  const lastPage = Math.max(1, Math.ceil(count / pageSize))
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(count, page * pageSize)

  return (
    <nav
      aria-label="Pagination"
      className="border-rule text-ink-2 flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-sm"
    >
      <p className="tabular">
        Showing{' '}
        <span className="text-ink font-medium">
          {fmt.format(from)}–{fmt.format(to)}
        </span>{' '}
        of <span className="text-ink font-medium">{fmt.format(count)}</span>
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <label className="flex items-center gap-2">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="border-rule-strong bg-surface text-ink h-8 rounded border px-2 text-sm"
            >
              {pageSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          icon={<ChevronLeft className="size-4" aria-hidden />}
        >
          Previous
        </Button>
        <span className="tabular px-1">
          Page {page} of {lastPage}
        </span>
        <Button size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= lastPage}>
          Next
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  )
}
