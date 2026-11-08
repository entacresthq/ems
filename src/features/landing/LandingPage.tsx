import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  BadgeCheck,
  Building2,
  ChartColumn,
  Check,
  ClipboardCheck,
  FileClock,
  HandCoins,
  PiggyBank,
  ShieldCheck,
  Smartphone,
  UserCog,
  Users,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { signupApi, type Plan } from '@/api/subscription'
import { Logo } from '@/components/ui/Logo'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { formatNaira } from '@/lib/money'

/**
 * What visitors see at the bare address before signing in: what EMS does, the plans
 * (live from SynchGate, so they match sign-up), and the way in.
 */
export function LandingPage() {
  useDocumentTitle('EMS: cooperative, thrift and loan management')
  return (
    <div className="bg-paper text-ink min-h-dvh">
      <Header />
      <main>
        <Hero />
        <Features />
        <FieldApp />
        <HowItWorks />
        <Pricing />
        <Faq />
        <ClosingCall />
      </main>
      <Footer />
    </div>
  )
}

const primary =
  'bg-ledger hover:bg-ledger-strong inline-flex h-12 items-center justify-center rounded px-5 font-medium text-white transition-colors'
const secondary =
  'border-rule-strong bg-surface hover:bg-ink-tint inline-flex h-12 items-center justify-center rounded border px-5 font-medium text-ink transition-colors'

function Header() {
  return (
    <header className="border-rule bg-paper/95 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link to="/" aria-label="EMS home">
          <span className="hidden sm:block">
            <Logo withProduct />
          </span>
          <span className="sm:hidden">
            <Logo />
          </span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1 text-sm sm:gap-2" aria-label="Main">
          <a href="#features" className="text-ink-2 hover:text-ink hidden px-3 py-2 md:inline">
            Features
          </a>
          <a href="#pricing" className="text-ink-2 hover:text-ink hidden px-3 py-2 md:inline">
            Pricing
          </a>
          <a href="#faq" className="text-ink-2 hover:text-ink hidden px-3 py-2 md:inline">
            Questions
          </a>
          <Link to="/login" className="text-ink px-3 py-2 font-medium">
            Sign in
          </Link>
          <Link to="/signup" className={cn(primary, 'h-10 px-4 text-sm')}>
            <span className="sm:hidden">Free trial</span>
            <span className="hidden sm:inline">Start free trial</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
      <div>
        <p className="text-ledger text-sm font-semibold tracking-wide uppercase">
          For cooperatives, thrift and microfinance businesses
        </p>
        <h1 className="mt-3 text-4xl leading-tight font-semibold sm:text-5xl">
          Run every branch, every officer and every naira from one place.
        </h1>
        <p className="text-ink-2 mt-5 max-w-xl text-lg">
          EMS keeps your customers, savings, thrift and loans in order. Officers collect in the
          field on their phones, even without network, and head office sees the whole business as it
          happens.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/signup" className={primary}>
            Start your free trial
          </Link>
          <a href="#features" className={secondary}>
            See what it does
          </a>
        </div>
        <p className="text-ink-3 mt-4 text-sm">
          No card needed to start. Cancel by simply not renewing.
        </p>
      </div>
      <DashboardPreview />
    </section>
  )
}

/** An illustration of the dashboard, with sample figures. */
function DashboardPreview() {
  const bars = [62, 74, 58, 81, 77, 90, 85]
  return (
    <figure
      className="border-rule bg-surface rounded-lg border p-5 shadow-sm"
      aria-label="An example of the EMS dashboard"
    >
      <div className="flex items-center justify-between">
        <figcaption className="text-sm font-semibold">Collections today</figcaption>
        <span className="text-ink-3 text-xs">Example</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          ['Expected', '₦1,240,000'],
          ['Collected', '₦1,086,500'],
          ['Rate', '87.6%'],
        ].map(([label, value]) => (
          <div key={label} className="bg-paper rounded p-3">
            <p className="text-ink-3 text-xs">{label}</p>
            <p className="tabular mt-1 text-sm font-semibold sm:text-base">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex h-28 items-end gap-2" aria-hidden>
        {bars.map((h, i) => (
          <div
            key={i}
            className={cn(
              'flex-1 rounded-t',
              i === bars.length - 1 ? 'bg-ledger' : 'bg-ledger-tint',
            )}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="border-rule mt-5 grid gap-2 border-t pt-4 text-sm">
        {[
          ['Egbeda branch', '94%'],
          ['Ikotun branch', '88%'],
          ['Ipaja branch', '79%'],
        ].map(([branch, rate]) => (
          <div key={branch} className="flex justify-between">
            <span className="text-ink-2">{branch}</span>
            <span className="tabular font-medium">{rate}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Users,
    title: 'Customers and KYC',
    text: 'Photos, signatures, BVN, next of kin and guarantors, with each customer assigned to an officer and an area.',
  },
  {
    icon: PiggyBank,
    title: 'Savings, target savings and thrift',
    text: 'Daily or weekly thrift plans with your commission rules, savings goals that can lock until reached, and withdrawal charges you set.',
  },
  {
    icon: HandCoins,
    title: 'Loans from application to close',
    text: 'Flat or reducing-balance interest, schedules that skip your closed days, penalties, top-ups, extensions and buy now pay later.',
  },
  {
    icon: ClipboardCheck,
    title: 'Evening cash count',
    text: 'Every officer’s expected cash for the day, counted and signed off by the accountant, with any shortfall explained.',
  },
  {
    icon: BadgeCheck,
    title: 'Approvals built in',
    text: 'Reversals, large withdrawals, loans and new field customers wait for a second person, so no one can do it all alone.',
  },
  {
    icon: ChartColumn,
    title: 'Dashboards and 12 reports',
    text: 'Collections against expected, portfolio at risk, income and staff performance, exported to Excel, CSV or PDF.',
  },
  {
    icon: Building2,
    title: 'Head office and branches',
    text: 'Branch staff see their branch; head office sees and compares them all. Add branches as you grow.',
  },
  {
    icon: UserCog,
    title: 'Roles and permissions',
    text: 'MD, managers, accountants, cashiers, officers and admins, each with exactly the access you choose.',
  },
  {
    icon: FileClock,
    title: 'A full audit trail',
    text: 'Every sign-in and every change is recorded with who, when and from where. Nothing is silently edited.',
  },
]

function Features() {
  return (
    <section id="features" className="bg-surface border-rule scroll-mt-16 border-y">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <h2 className="max-w-2xl text-3xl font-semibold">
          Everything a lending cooperative does, in one system
        </h2>
        <p className="text-ink-2 mt-3 max-w-2xl">
          Built around how Nigerian thrift and loan businesses actually work: officers in the
          market, cash counted every evening, and decisions that need a second pair of eyes.
        </p>
        <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title}>
              <div className="bg-ledger-tint text-ledger flex size-10 items-center justify-center rounded">
                <Icon className="size-5" aria-hidden />
              </div>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="text-ink-2 mt-1.5 text-sm leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FieldApp() {
  const points = [
    'Today’s customers, grouped by area, with what each one owes',
    'Records collections with or without network, and syncs when it returns',
    'A text receipt to the customer for every collection',
    'Registers new thrift customers on the spot, for approval at the office',
    'Opens behind a 6-digit PIN, and can be installed on any Android phone',
  ]
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:py-20 lg:grid-cols-2 [&>*]:min-w-0">
      <div className="bg-ink rounded-lg p-8 text-white">
        <div className="flex items-center gap-3">
          <Smartphone className="text-ledger-bright size-6" aria-hidden />
          <p className="font-semibold">The field app</p>
        </div>
        <div className="mt-6 grid gap-3">
          {[
            ['Mrs Bisi Adeyemi', 'Market · Thrift', '₦1,000'],
            ['Tunde Bello', 'Market · Loan', '₦13,000'],
            ['Kemi Lawal', 'Station Rd · Thrift', '₦500'],
          ].map(([name, meta, amount]) => (
            <div
              key={name}
              className="flex items-center justify-between rounded bg-white/10 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs text-white/70">{meta}</p>
              </div>
              <span className="tabular text-sm font-semibold">{amount}</span>
            </div>
          ))}
        </div>
        <p className="mt-6 flex items-center gap-2 text-sm text-white/80">
          <WifiOff className="size-4" aria-hidden /> Saved on the phone. Will sync when online.
        </p>
      </div>
      <div>
        <h2 className="text-3xl font-semibold">Your officers carry the office in their pocket</h2>
        <p className="text-ink-2 mt-3">
          Account officers get their own app, made for a day on the move. Every collection is kept
          on the phone first, so a lost signal never loses money, and nothing is ever counted twice.
        </p>
        <ul className="mt-6 grid gap-3">
          {points.map((p) => (
            <li key={p} className="flex gap-3">
              <Check className="text-ledger mt-0.5 size-5 shrink-0" aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    [
      'Sign up in minutes',
      'Choose a plan, name your business and create your account. You are the managing director.',
    ],
    [
      'Set up your business',
      'Add your branches, staff, thrift plans and loan products. Each person signs in with their own account.',
    ],
    [
      'Start working',
      'Register customers, open accounts and send officers out. Pay monthly once the free trial ends.',
    ],
  ]
  return (
    <section className="bg-surface border-rule border-y">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <h2 className="text-3xl font-semibold">Up and running the same day</h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {steps.map(([title, text], i) => (
            <li key={title}>
              <span className="bg-ink flex size-9 items-center justify-center rounded-full text-sm font-semibold text-white">
                {i + 1}
              </span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="text-ink-2 mt-1.5 text-sm leading-relaxed">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function limitText(plan: Plan) {
  if (plan.maxBranches === null) return 'Unlimited branches'
  return plan.maxBranches === 1 ? '1 branch' : `Up to ${plan.maxBranches} branches`
}

function Pricing() {
  const offer = useQuery({ queryKey: ['signup', 'offer'], queryFn: signupApi.offer, retry: 1 })
  // Pricing is a bonus on this page: if it can't load, the rest still makes sense.
  if (offer.isError) return null
  const plans = offer.data?.plans ?? []
  const featured = plans.length >= 3 ? plans[1]?.code : null
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 md:py-20">
      <h2 className="text-3xl font-semibold">Simple monthly pricing</h2>
      <p className="text-ink-2 mt-3 max-w-2xl">
        {offer.data
          ? `Every plan starts with a ${offer.data.trialDays}-day free trial. Pay monthly, or for several months at once, with card, bank transfer or USSD.`
          : 'Every plan starts with a free trial.'}
      </p>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {offer.isPending
          ? [0, 1, 2].map((i) => (
              <div
                key={i}
                className="border-rule bg-surface h-80 animate-pulse rounded-lg border"
              />
            ))
          : plans.map((plan) => (
              <div
                key={plan.code}
                className={cn(
                  'bg-surface flex flex-col rounded-lg border p-6',
                  plan.code === featured ? 'border-ledger ring-ledger ring-1' : 'border-rule',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  {plan.code === featured && (
                    <span className="bg-ledger-tint text-ledger rounded-sm px-2 py-0.5 text-xs font-semibold">
                      Most popular
                    </span>
                  )}
                </div>
                {plan.description && <p className="text-ink-2 mt-1 text-sm">{plan.description}</p>}
                <p className="mt-5">
                  <span className="tabular text-3xl font-semibold">
                    {formatNaira(plan.monthlyPrice, { trimZeroKobo: true })}
                  </span>
                  <span className="text-ink-2"> a month</span>
                </p>
                <p className="text-ink-2 mt-1 text-sm">
                  {limitText(plan)}
                  {plan.maxStaff === undefined
                    ? ''
                    : plan.maxStaff === null
                      ? ' · unlimited staff'
                      : ` · up to ${plan.maxStaff} staff`}
                </p>
                <ul className="mt-5 flex flex-1 flex-col gap-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="text-ledger mt-0.5 size-4 shrink-0" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/signup"
                  className={cn(plan.code === featured ? primary : secondary, 'mt-6 w-full')}
                >
                  Start free trial
                </Link>
              </div>
            ))}
      </div>
    </section>
  )
}

const QUESTIONS: [string, string][] = [
  [
    'What happens when the free trial ends?',
    'You choose a plan and pay under Administration → Subscription. If you don’t, EMS keeps working for a few days, then only the subscription page opens until you renew. Your data is kept the whole time.',
  ],
  [
    'Do my officers need internet to collect?',
    'No. The field app keeps collections on the phone and sends them when the network returns. Each collection can only ever be recorded once.',
  ],
  [
    'Can staff only see what they should?',
    'Yes. Each person gets a role and the permissions you choose. Branch staff see their own branch, officers see their own customers, and head office sees everything.',
  ],
  [
    'How do people sign in?',
    'With their email and password, plus a 6-digit code sent to their email each time. Sessions end after a period of no activity.',
  ],
  [
    'Can I change my plan later?',
    'Yes, at any time. Time you have already paid for is carried over to the new plan at its price, so nothing is lost.',
  ],
  [
    'Where is my data kept?',
    'On Entacrest’s servers, separate from every other business. Nobody outside your business can see your customers or figures.',
  ],
]

function Faq() {
  return (
    <section id="faq" className="bg-surface border-rule scroll-mt-16 border-y">
      <div className="mx-auto max-w-3xl px-4 py-16 md:py-20">
        <h2 className="text-3xl font-semibold">Questions</h2>
        <div className="divide-rule border-rule mt-8 divide-y border-y">
          {QUESTIONS.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {q}
                <span
                  className="text-ink-3 text-xl transition-transform group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="text-ink-2 mt-2 text-sm leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function ClosingCall() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
      <div className="bg-ink rounded-lg px-6 py-12 text-center text-white sm:px-12">
        <ShieldCheck className="text-ledger-bright mx-auto size-8" aria-hidden />
        <h2 className="mt-4 text-3xl font-semibold">Give your business the system it deserves</h2>
        <p className="mx-auto mt-3 max-w-xl text-white/80">
          Start free today. Set up your branches and staff, and see your whole business on one
          screen by evening.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/signup" className={primary}>
            Start your free trial
          </Link>
          <Link
            to="/login"
            className="inline-flex h-12 items-center justify-center rounded border border-white/40 px-5 font-medium text-white hover:bg-white/10"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-rule border-t">
      <div className="text-ink-2 mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <span>EMS is an Entacrest Nexus product.</span>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
          <a href="https://entacrest.com" className="hover:text-ink">
            Entacrest
          </a>
          <Link to="/login" className="hover:text-ink">
            Sign in
          </Link>
          <Link to="/field/login" className="hover:text-ink">
            Field app
          </Link>
          <Link to="/signup" className="hover:text-ink">
            Start free trial
          </Link>
        </nav>
      </div>
    </footer>
  )
}
