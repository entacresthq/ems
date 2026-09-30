import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileText } from 'lucide-react'
import { adminKeys, settingsApi } from '@/api/admin'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { downloadFile, toCsv, type CsvColumn } from '@/lib/csv'
import { todayIso } from '@/lib/dates'
import { exportTablePdf, titleFromFilename } from '@/lib/tableExport'

type Format = 'csv' | 'pdf'

/**
 * Two buttons, CSV for spreadsheets and PDF for printing or sharing.
 * Both export every row matching the current filters, not just the visible page.
 */
export function ExportButton<T>({
  filename,
  columns,
  fetchRows,
  label = 'Export',
  title,
}: {
  filename: string
  columns: CsvColumn<T>[]
  fetchRows: () => Promise<T[]>
  /** Shown before the format, e.g. "Export statement" gives "Export statement CSV". */
  label?: string
  /** Heading printed at the top of the PDF. Defaults to the file name. */
  title?: string
}) {
  const [busy, setBusy] = useState<Format | null>(null)
  const toast = useToast()
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: settingsApi.get })

  const run = async (format: Format) => {
    setBusy(format)
    try {
      const rows = await fetchRows()
      if (format === 'csv') {
        downloadFile(`${filename}-${todayIso()}.csv`, toCsv(columns, rows))
      } else {
        await exportTablePdf(
          {
            filename,
            title: title ?? titleFromFilename(filename),
            businessName: settings.data?.businessName ?? 'EMS',
            columns,
            rows,
          },
          todayIso(),
        )
      }
      toast({
        title: 'Export ready',
        description: `${rows.length} rows saved to your downloads as ${format.toUpperCase()}.`,
      })
    } catch {
      toast({
        tone: 'danger',
        title: 'Export failed',
        description: 'Check your connection and try again.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button
        size="md"
        loading={busy === 'csv'}
        loadingLabel="Preparing…"
        disabled={busy === 'pdf'}
        icon={<Download className="size-4" aria-hidden />}
        onClick={() => run('csv')}
      >
        {label} CSV
      </Button>
      <Button
        size="md"
        loading={busy === 'pdf'}
        loadingLabel="Preparing…"
        disabled={busy === 'csv'}
        icon={<FileText className="size-4" aria-hidden />}
        onClick={() => run('pdf')}
      >
        {label} PDF
      </Button>
    </>
  )
}
