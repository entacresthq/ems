import { useRouteError } from 'react-router-dom'
import { ButtonLink } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export function ForbiddenPage() {
  useDocumentTitle('No access')
  return (
    <div className="max-w-lg py-10">
      <h1 className="text-xl font-semibold">You don't have access to this page</h1>
      <p className="text-ink-2 mt-2 text-sm">
        Your role doesn't include this area. If you need it for your work, ask your branch manager
        or an administrator to update your permissions.
      </p>
      <ButtonLink to="/" className="mt-6">
        Go to dashboard
      </ButtonLink>
    </div>
  )
}

export function NotFoundPage() {
  useDocumentTitle('Page not found')
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4">
      <Logo />
      <h1 className="mt-8 text-xl font-semibold">We couldn't find that page</h1>
      <p className="text-ink-2 mt-2 text-sm">
        The link may be old or mistyped. Check the address, or go back to the start.
      </p>
      <ButtonLink to="/" variant="primary" className="mt-6 self-start">
        Go to the start
      </ButtonLink>
    </div>
  )
}

/** Last-resort screen when a page crashes. */
export function CrashPage() {
  const error = useRouteError()
  if (import.meta.env.DEV) console.error(error)
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4">
      <Logo />
      <h1 className="mt-8 text-xl font-semibold">Something went wrong on this screen</h1>
      <p className="text-ink-2 mt-2 text-sm">
        Reload the page to try again. Anything you saved is safe. If it keeps happening, tell
        support what you were doing when it stopped.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="bg-ledger hover:bg-ledger-strong mt-6 self-start rounded px-4 py-2 text-sm font-medium text-white"
      >
        Reload page
      </button>
    </div>
  )
}
