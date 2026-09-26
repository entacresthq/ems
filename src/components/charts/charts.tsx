import { useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/dates'
import { formatNaira, type Kobo } from '@/lib/money'

/** Compact naira for axes and labels: ₦1.2m, ₦850k, ₦900. */
export function compactNaira(amount: number): string {
  const n = amount / 100
  if (Math.abs(n) >= 1_000_000) return `₦${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`
  if (Math.abs(n) >= 1_000) return `₦${Math.round(n / 1_000)}k`
  return `₦${Math.round(n)}`
}

/** Clean axis maximum: 1, 2, 2.5 or 5 × a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value) ?? 10
  return step * power
}

export function StatTile({
  label,
  value,
  detail,
  tone,
  href,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: 'danger' | 'warning' | 'success'
  href?: string
}) {
  const body = (
    <>
      <p className="text-ink-2 text-xs font-medium">{label}</p>
      <p
        className={cn(
          'tabular mt-1 font-semibold break-words',
          typeof value === 'string' && value.length > 11 ? 'text-lg' : 'text-xl',
          tone === 'danger' && 'text-brick',
          tone === 'warning' && 'text-ochre',
          tone === 'success' && 'text-ledger',
        )}
      >
        {value}
      </p>
      {detail && <p className="text-ink-2 mt-0.5 text-xs">{detail}</p>}
    </>
  )
  return href ? (
    <Link to={href} className="bg-surface hover:bg-paper block px-4 py-3">
      {body}
    </Link>
  ) : (
    <div className="bg-surface px-4 py-3">{body}</div>
  )
}

function TableToggle({ showTable, onToggle }: { showTable: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-ink-2 hover:text-ink text-xs font-medium underline underline-offset-2"
    >
      {showTable ? 'Show chart' : 'Show as table'}
    </button>
  )
}

// ── Horizontal bars with an expected-value tick ───────────────────────────

export interface TargetBarItem {
  id: string
  label: string
  value: Kobo
  target: Kobo
}

/**
 * One bar per row (collected) with a tick at the target (expected).
 * Single series in Ledger; the tick is ink. Hover or focus a row for figures.
 */
export function TargetBars({
  items,
  title,
  valueLabel,
  targetLabel,
}: {
  items: TargetBarItem[]
  title: string
  valueLabel: string
  targetLabel: string
}) {
  const [showTable, setShowTable] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const max = niceMax(Math.max(1, ...items.map((i) => Math.max(i.value, i.target))))

  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-ink-2 flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="bg-ledger h-2.5 w-4 rounded-sm" aria-hidden /> {valueLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-ink h-3 w-0.5" aria-hidden /> {targetLabel}
          </span>
          <TableToggle showTable={showTable} onToggle={() => setShowTable((s) => !s)} />
        </span>
      </figcaption>
      {showTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-rule text-ink-2 border-b text-left text-xs">
              <th className="py-1.5 font-semibold">Name</th>
              <th className="py-1.5 text-right font-semibold">{valueLabel}</th>
              <th className="py-1.5 text-right font-semibold">{targetLabel}</th>
              <th className="py-1.5 text-right font-semibold">Rate</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-rule border-b last:border-0">
                <td className="py-1.5">{i.label}</td>
                <td className="tabular py-1.5 text-right">{formatNaira(i.value)}</td>
                <td className="tabular py-1.5 text-right">{formatNaira(i.target)}</td>
                <td className="tabular py-1.5 text-right">
                  {i.target > 0 ? `${Math.round((i.value / i.target) * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((i) => {
            const pct = i.target > 0 ? Math.round((i.value / i.target) * 100) : null
            const isActive = active === i.id
            return (
              <li
                key={i.id}
                tabIndex={0}
                onPointerEnter={() => setActive(i.id)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i.id)}
                onBlur={() => setActive(null)}
                aria-label={`${i.label}: ${formatNaira(i.value)} of ${formatNaira(i.target)} ${targetLabel.toLowerCase()}`}
                className="hover:bg-paper relative grid grid-cols-[8rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded px-1 py-1.5 outline-offset-0 sm:grid-cols-[10rem_minmax(0,1fr)_5rem]"
              >
                <span className="truncate text-sm">{i.label}</span>
                <span className="relative h-5">
                  <span
                    aria-hidden
                    className={cn(
                      'bg-ledger absolute top-0.5 left-0 h-4 max-h-6 rounded-r transition-opacity',
                      active && !isActive && 'opacity-50',
                    )}
                    style={{ width: `${(i.value / max) * 100}%` }}
                  />
                  <span
                    aria-hidden
                    className="bg-ink absolute -top-0.5 h-6 w-0.5"
                    style={{ left: `calc(${(i.target / max) * 100}% - 1px)` }}
                  />
                </span>
                <span className="tabular text-right text-sm">{pct === null ? '—' : `${pct}%`}</span>
                {isActive && (
                  <span
                    role="tooltip"
                    className="border-rule bg-surface shadow-overlay pointer-events-none absolute top-full left-40 z-10 mt-1 rounded border px-3 py-2 text-xs"
                  >
                    <strong className="tabular block text-sm">{formatNaira(i.value)}</strong>
                    <span className="text-ink-2">
                      {valueLabel.toLowerCase()} of {formatNaira(i.target)}{' '}
                      {targetLabel.toLowerCase()}
                    </span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </figure>
  )
}

// ── Trend line ────────────────────────────────────────────────────────────

/** Single-series daily trend: 2px line, light wash, crosshair tooltip, end label. */
export function TrendChart({
  points,
  title,
  valueLabel,
}: {
  points: { date: string; value: Kobo }[]
  title: string
  valueLabel: string
}) {
  const [showTable, setShowTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gradientId = useId()
  const W = 640
  const H = 200
  const pad = { l: 48, r: 56, t: 12, b: 26 }
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)))
  const x = (i: number) =>
    pad.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const path = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ')
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const last = points[points.length - 1]

  const onMove = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || points.length === 0) return
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, i)))
  }

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <TableToggle showTable={showTable} onToggle={() => setShowTable((s) => !s)} />
      </figcaption>
      {showTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-rule text-ink-2 border-b text-left text-xs">
              <th className="py-1.5 font-semibold">Date</th>
              <th className="py-1.5 text-right font-semibold">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date} className="border-rule border-b last:border-0">
                <td className="py-1.5">{formatDate(p.date)}</td>
                <td className="tabular py-1.5 text-right">{formatNaira(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none"
            role="img"
            aria-label={`${title}. Latest ${last ? formatNaira(last.value) : 'no data'}.`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? points.length) - 1))
              if (e.key === 'ArrowRight')
                setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1))
            }}
            onBlur={() => setHover(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--color-ledger)" stopOpacity="0.12" />
                <stop offset="1" stopColor="var(--color-ledger)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={pad.l}
                  x2={W - pad.r}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--color-rule)"
                  strokeWidth="1"
                />
                <text
                  x={pad.l - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--color-ink-3)"
                >
                  {compactNaira(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 5) === 0 ? (
                <text
                  key={p.date}
                  x={x(i)}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--color-ink-3)"
                >
                  {formatDate(p.date).slice(0, 6)}
                </text>
              ) : null,
            )}
            {points.length > 1 && (
              <path
                d={`${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
                fill={`url(#${gradientId})`}
              />
            )}
            <path
              d={path}
              fill="none"
              stroke="var(--color-ledger)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {last && (
              <>
                <circle
                  cx={x(points.length - 1)}
                  cy={y(last.value)}
                  r="4.5"
                  fill="var(--color-ledger)"
                  stroke="var(--color-surface)"
                  strokeWidth="2"
                />
                <text
                  x={x(points.length - 1) + 8}
                  y={y(last.value) + 4}
                  fontSize="12"
                  fontWeight="600"
                  fill="var(--color-ink)"
                >
                  {compactNaira(last.value)}
                </text>
              </>
            )}
            {hover !== null && points[hover] && (
              <g>
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={pad.t}
                  y2={y(0)}
                  stroke="var(--color-ink-3)"
                  strokeWidth="1"
                />
                <circle
                  cx={x(hover)}
                  cy={y(points[hover].value)}
                  r="4.5"
                  fill="var(--color-ledger)"
                  stroke="var(--color-surface)"
                  strokeWidth="2"
                />
              </g>
            )}
          </svg>
          {hover !== null && points[hover] && (
            <div
              role="tooltip"
              className="border-rule bg-surface shadow-overlay pointer-events-none absolute top-0 z-10 rounded border px-3 py-2 text-xs"
              style={{ left: `${Math.min(75, (x(hover) / W) * 100)}%` }}
            >
              <strong className="tabular block text-sm">{formatNaira(points[hover].value)}</strong>
              <span className="text-ink-2">{formatDate(points[hover].date)}</span>
            </div>
          )}
        </div>
      )}
    </figure>
  )
}
