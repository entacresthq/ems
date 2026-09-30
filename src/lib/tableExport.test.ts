import { describe, expect, it } from 'vitest'
import { pdfCellText, pdfSafe, pdfTable, titleFromFilename } from './tableExport'

describe('table PDF export', () => {
  it('replaces characters the built-in PDF fonts cannot draw', () => {
    expect(pdfSafe('₦5,000 – Ade’s “shop” · Ikeja…')).toBe('NGN 5,000 - Ade\'s "shop" - Ikeja...')
    expect(pdfSafe('Emoji 😀 gone')).toBe('Emoji  gone')
  })

  it('formats money columns with separators and two decimals', () => {
    expect(pdfCellText('Balance (NGN)', '1234567.5')).toBe('1,234,567.50')
    expect(pdfCellText('Balance (NGN)', 0)).toBe('0.00')
    expect(pdfCellText('Amount (NGN)', '-2500')).toBe('-2,500.00')
    expect(pdfCellText('Balance (NGN)', '')).toBe('')
    expect(pdfCellText('Balance (NGN)', null)).toBe('')
  })

  it('leaves other columns alone, even if they hold numbers', () => {
    expect(pdfCellText('Account number', '2110000001')).toBe('2110000001')
    expect(pdfCellText('Status', 'active')).toBe('active')
  })

  it('builds the head, the rows and which columns are right-aligned', () => {
    const t = pdfTable(
      [
        { header: 'Customer', value: (r: { n: string; b: string }) => r.n },
        { header: 'Balance (NGN)', value: (r) => r.b },
      ],
      [
        { n: 'Ada', b: '1500' },
        { n: 'Tunde', b: '20.5' },
      ],
    )
    expect(t.head).toEqual(['Customer', 'Balance (NGN)'])
    expect(t.body).toEqual([
      ['Ada', '1,500.00'],
      ['Tunde', '20.50'],
    ])
    expect(t.alignRight).toEqual([false, true])
  })

  it('makes a title from the file name', () => {
    expect(titleFromFilename('statement-2110000001')).toBe('Statement 2110000001')
    expect(titleFromFilename('audit-log')).toBe('Audit log')
  })
})
