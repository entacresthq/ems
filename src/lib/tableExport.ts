import type { CsvColumn } from './csv'
import { formatDateTime } from './dates'

/**
 * The fonts built into PDF files only cover basic Latin letters, so naira signs,
 * curly quotes and dashes would come out as rubbish. Swap them for plain equivalents.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/₦/g, 'NGN ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, '')
    .trim()
}

/** Columns headed "(NGN)" hold money as plain decimals such as "12500.5". */
export const isMoneyHeader = (header: string) => /\(NGN\)\s*$/.test(header)

/** Money with thousands separators and two decimals; anything else is left as text. */
export function pdfCellText(header: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const text = String(value)
  if (isMoneyHeader(header) && /^-?\d+(\.\d+)?$/.test(text)) {
    return new Intl.NumberFormat('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(text))
  }
  return pdfSafe(text)
}

/** "statement-2110000001" becomes "Statement 2110000001". */
export function titleFromFilename(filename: string): string {
  const words = filename.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface TablePdfOptions<T> {
  /** Without the extension or date. */
  filename: string
  title: string
  businessName: string
  columns: CsvColumn<T>[]
  rows: T[]
}

/** Build the table a PDF would show, so it can be checked without making a file. */
export function pdfTable<T>(columns: CsvColumn<T>[], rows: T[]) {
  return {
    head: columns.map((c) => pdfSafe(c.header)),
    body: rows.map((r) => columns.map((c) => pdfCellText(c.header, c.value(r)))),
    alignRight: columns.map((c) => isMoneyHeader(c.header)),
  }
}

/** Any list on screen as a PDF: business name, title, date, then the table with page numbers. */
export async function exportTablePdf<T>(o: TablePdfOptions<T>, today: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const table = pdfTable(o.columns, o.rows)
  const doc = new jsPDF({
    orientation: o.columns.length > 6 ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  })
  const width = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(pdfSafe(o.businessName), 40, 40)
  doc.setFontSize(15)
  doc.text(pdfSafe(o.title), 40, 62)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(
    `${o.rows.length} ${o.rows.length === 1 ? 'row' : 'rows'} - generated ${pdfSafe(formatDateTime(new Date()))}`,
    40,
    78,
  )
  autoTable(doc, {
    startY: 92,
    head: [table.head],
    body: table.body,
    styles: { fontSize: 8, cellPadding: 4, textColor: [21, 32, 27], overflow: 'linebreak' },
    headStyles: { fillColor: [21, 32, 27], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 244, 238] },
    columnStyles: Object.fromEntries(
      table.alignRight.map((right, i) => [i, { halign: right ? 'right' : 'left' }]),
    ),
    margin: { left: 40, right: 40, bottom: 36 },
    didDrawPage: () => {
      doc.setFontSize(8)
      doc.setTextColor(120)
      doc.text(
        `Page ${doc.getNumberOfPages()}`,
        width - 40,
        doc.internal.pageSize.getHeight() - 20,
        { align: 'right' },
      )
    },
  })
  doc.save(`${o.filename}-${today}.pdf`)
}
