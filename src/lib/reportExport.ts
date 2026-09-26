import { downloadFile, toCsv } from './csv'
import { formatDate, formatDateTime } from './dates'
import { formatNaira, parseDecimal } from './money'
import { formatPhone } from './phone'
import type { ReportCell, ReportColumn, ReportResult } from '@/types'

export interface ReportMeta {
  businessName: string
  /** e.g. "Egbeda branch · Olumide Salami" */
  scope: string
}

const isMoney = (c: ReportColumn) => c.type === 'money'

/** Display text for a cell, as on screen. */
export function cellText(column: ReportColumn, cell: ReportCell | undefined): string {
  if (cell === null || cell === undefined || cell === '') return ''
  switch (column.type) {
    case 'money':
      return formatNaira(parseDecimal(String(cell)))
    case 'number':
      return new Intl.NumberFormat('en-NG').format(Number(cell))
    case 'percent':
      return `${cell}%`
    case 'date':
      return formatDate(String(cell))
    case 'phone':
      return formatPhone(String(cell))
    default:
      return String(cell)
  }
}

function periodText(r: ReportResult) {
  return r.period ? `${formatDate(r.period.from)} to ${formatDate(r.period.to)}` : 'As at today'
}

function fileName(r: ReportResult, ext: string) {
  const period = r.period
    ? `${r.period.from}_to_${r.period.to}`
    : new Date().toISOString().slice(0, 10)
  return `${r.key}-${period}.${ext}`
}

const allRows = (r: ReportResult) => (r.totals ? [...r.rows, r.totals] : r.rows)

export function exportCsv(r: ReportResult) {
  // Money as plain decimals (no ₦ or commas) so spreadsheets can add them up.
  const csv = toCsv(
    r.columns.map((c) => ({
      header: isMoney(c) ? `${c.label} (NGN)` : c.label,
      value: (row: Record<string, ReportCell>) =>
        isMoney(c)
          ? (row[c.key] ?? '')
          : c.type === 'date' || c.type === 'phone'
            ? cellText(c, row[c.key])
            : (row[c.key] ?? ''),
    })),
    allRows(r),
  )
  downloadFile(fileName(r, 'csv'), csv)
}

export async function exportXlsx(r: ReportResult, meta: ReportMeta) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  type Cell = {
    value: string | number
    type?: StringConstructor | NumberConstructor
    format?: string
    fontWeight?: 'bold'
  } | null
  const header: Cell[] = r.columns.map((c) => ({
    value: isMoney(c) ? `${c.label} (₦)` : c.label,
    fontWeight: 'bold',
  }))
  const toCell = (c: ReportColumn, v: ReportCell | undefined, bold: boolean): Cell => {
    if (v === null || v === undefined || v === '') return null
    const weight = bold ? ({ fontWeight: 'bold' } as const) : {}
    // Spreadsheet numbers: naira with two decimals, exact from the kobo integer.
    if (isMoney(c))
      return { value: parseDecimal(String(v)) / 100, type: Number, format: '#,##0.00', ...weight }
    if (c.type === 'number' || c.type === 'percent')
      return { value: Number(v), type: Number, ...weight }
    return { value: cellText(c, v), type: String, ...weight }
  }
  const data: Cell[][] = [
    [{ value: meta.businessName, fontWeight: 'bold' }],
    [{ value: r.title, fontWeight: 'bold' }],
    [{ value: `${meta.scope} · ${periodText(r)}` }],
    [{ value: `Generated ${formatDateTime(r.generatedAt)}` }],
    [],
    header,
    ...r.rows.map((row) => r.columns.map((c) => toCell(c, row[c.key], false))),
    ...(r.totals ? [r.columns.map((c) => toCell(c, r.totals![c.key], true))] : []),
    ...r.notes.map((n) => [{ value: n }]),
  ]
  await writeXlsxFile(data as never, {
    columns: r.columns.map((c) => ({ width: isMoney(c) ? 18 : c.type === 'text' ? 26 : 14 })),
  }).toFile(fileName(r, 'xlsx'))
}

export async function exportPdf(r: ReportResult, meta: ReportMeta) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF({
    orientation: r.columns.length > 6 ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  })
  const width = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(meta.businessName, 40, 40)
  doc.setFontSize(15)
  doc.text(r.title, 40, 62)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(`${meta.scope} · ${periodText(r)} · generated ${formatDateTime(r.generatedAt)}`, 40, 78)

  // Built-in PDF fonts have no naira sign, so money columns say (NGN) in the header.
  const pdfCell = (c: ReportColumn, v: ReportCell | undefined) =>
    isMoney(c) && v !== null && v !== undefined && v !== ''
      ? formatNaira(parseDecimal(String(v))).replace('₦', '')
      : cellText(c, v)
  autoTable(doc, {
    startY: 92,
    head: [r.columns.map((c) => (isMoney(c) ? `${c.label} (NGN)` : c.label))],
    body: r.rows.map((row) => r.columns.map((c) => pdfCell(c, row[c.key]))),
    foot: r.totals ? [r.columns.map((c) => pdfCell(c, r.totals![c.key]))] : undefined,
    styles: { fontSize: 8, cellPadding: 4, textColor: [21, 32, 27] },
    headStyles: { fillColor: [21, 32, 27], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 232, 224], textColor: [21, 32, 27], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 244, 238] },
    columnStyles: Object.fromEntries(
      r.columns.map((c, i) => [
        i,
        { halign: c.type === 'text' || c.type === 'date' || c.type === 'phone' ? 'left' : 'right' },
      ]),
    ),
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const page = doc.getNumberOfPages()
      doc.setFontSize(8)
      doc.setTextColor(120)
      doc.text(`Page ${page}`, width - 40, doc.internal.pageSize.getHeight() - 20, {
        align: 'right',
      })
    },
  })
  if (r.notes.length) {
    const y =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100
    doc.setFontSize(8)
    doc.setTextColor(80)
    r.notes.forEach((n, i) => doc.text(n, 40, y + 18 + i * 12))
  }
  doc.save(fileName(r, 'pdf'))
}
