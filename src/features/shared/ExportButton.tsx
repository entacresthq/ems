import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { downloadFile, toCsv, type CsvColumn } from '@/lib/csv'
import { todayIso } from '@/lib/dates'

/** Exports every row matching the current filters, not just the visible page. */
export function ExportButton<T>({
  filename,
  columns,
  fetchRows,
  label = 'Export CSV',
}: {
  filename: string
  columns: CsvColumn<T>[]
  fetchRows: () => Promise<T[]>
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  return (
    <Button
      size="md"
      loading={busy}
      loadingLabel="Preparing…"
      icon={<Download className="size-4" aria-hidden />}
      onClick={async () => {
        setBusy(true)
        try {
          const rows = await fetchRows()
          downloadFile(`${filename}-${todayIso()}.csv`, toCsv(columns, rows))
          toast({
            title: 'Export ready',
            description: `${rows.length} rows saved to your downloads.`,
          })
        } catch {
          toast({
            tone: 'danger',
            title: 'Export failed',
            description: 'Check your connection and try again.',
          })
        } finally {
          setBusy(false)
        }
      }}
    >
      {label}
    </Button>
  )
}
