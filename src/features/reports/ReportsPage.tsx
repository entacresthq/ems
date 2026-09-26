import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { REPORTS, type ReportDefinition } from '@/lib/reportCatalogue'

const GROUPS: ReportDefinition['group'][] = [
  'Performance',
  'Transactions and income',
  'Loans',
  'Accounts',
]

export function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Every report can be filtered by date, branch and officer, and exported to CSV, Excel or PDF, or printed."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {GROUPS.map((group) => (
          <section
            key={group}
            aria-labelledby={`group-${group}`}
            className="border-rule bg-surface rounded border"
          >
            <h2
              id={`group-${group}`}
              className="border-rule border-b px-4 py-3 text-sm font-semibold"
            >
              {group}
            </h2>
            <ul className="divide-rule divide-y">
              {REPORTS.filter((r) => r.group === group).map((r) => (
                <li key={r.key}>
                  <Link
                    to={`/reports/${r.key}`}
                    className="hover:bg-paper flex items-center gap-3 px-4 py-3"
                  >
                    <span className="flex-1">
                      <span className="block font-medium">{r.title}</span>
                      <span className="text-ink-2 block text-sm">{r.description}</span>
                    </span>
                    <ChevronRight className="text-ink-3 size-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
