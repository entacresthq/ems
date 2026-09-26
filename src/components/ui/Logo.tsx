import { useId } from 'react'
import { cn } from '@/lib/cn'

const NAVY = '#0A2A6B'

/**
 * The Entacrest mark, traced from the brand logo. Keep in step with
 * public/logo.svg, which the favicon and install icons are generated from.
 */
export function LogoMark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  // useId returns characters such as ":" that break url(#…) references.
  const id = `logo${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const ochre = `${id}-ochre`
  const disc = `${id}-disc`
  return (
    <svg viewBox="0 0 710 714" className={cn('size-8 shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={ochre} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#F7924B" />
          <stop offset="1" stopColor="#FAD62C" />
        </linearGradient>
        <clipPath id={disc}>
          <circle cx="355" cy="357" r="345" />
        </clipPath>
      </defs>
      {/* The navy ring would vanish on a dark background, so it sits on a white disc. */}
      {onDark && <circle cx="355" cy="357" r="357" fill="#FFFFFF" />}
      <g fill="none" stroke={NAVY} strokeWidth="60">
        <path d="M71.4 494.1A315 315 0 0 1 512.5 84.2" />
        <path d="M643.4 230.4A315 315 0 0 1 197.5 629.8" />
      </g>
      <g fill={NAVY} clipPath={`url(#${disc})`}>
        <path d="M200 255L710 -81V14L200 350Z" />
        <path d="M510 449L0 785V690L510 354Z" />
      </g>
      <path fill={`url(#${ochre})`} d="M200 400L510 199V304L200 505Z" />
      {[
        [71.4, 494.1],
        [643.4, 230.4],
      ].map(([cx, cy]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r="56" fill={NAVY} />
          <circle cx={cx} cy={cy} r="41" fill="#FFFFFF" />
          <circle cx={cx} cy={cy} r="29" fill={`url(#${ochre})`} />
        </g>
      ))}
    </svg>
  )
}

/** Entacrest MFB Solution (EMS), an Entacrest Nexus product. */
export function Logo({
  className,
  withName = true,
  onDark = false,
  withProduct = false,
}: {
  className?: string
  withName?: boolean
  onDark?: boolean
  /** Show "Entacrest MFB Solution" under the name (sign-in screens). */
  withProduct?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark onDark={onDark} className={withProduct ? 'size-10' : undefined} />
      {withName && (
        <span className="flex flex-col leading-tight">
          <span
            className={cn(
              'text-lg font-semibold tracking-tight',
              onDark ? 'text-white' : 'text-ink',
            )}
          >
            EMS
          </span>
          {withProduct && (
            <span className={cn('text-xs', onDark ? 'text-white/70' : 'text-ink-2')}>
              Entacrest MFB Solution
            </span>
          )}
        </span>
      )}
      {!withName && <span className="sr-only">EMS, Entacrest MFB Solution</span>}
    </span>
  )
}
