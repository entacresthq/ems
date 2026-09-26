export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

function escape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  // Guard against spreadsheet formula injection from customer-entered text.
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => escape(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => escape(c.value(row))).join(','))
  return lines.join('\r\n')
}

export function downloadFile(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  // BOM so Excel opens ₦ and accented names correctly.
  const blob = new Blob(['﻿', content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
