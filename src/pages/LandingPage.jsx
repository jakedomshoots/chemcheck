import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  Camera,
  CheckCircle,
  Droplets,
  MapPin,
  Receipt,
  Route,
  Smartphone,
  WifiOff,
} from 'lucide-react';

function updateMeta(name, content) {
  if (typeof document === 'undefined') return;
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

export default function LandingPage() {
  useEffect(() => {
    document.title = 'ChemCheck - Pool Service Management App';
    updateMeta(
      'description',
      'ChemCheck helps pool service professionals plan routes, capture visit proof, and manage reports in one mobile app.'
    );
  }, []);

  const valueProps = [
    {
      icon: Route,
      title: 'Route the day',
      description: 'See the next stop, tighten the drive, and keep the schedule readable for the whole crew.',
    },
    {
      icon: Camera,
      title: 'Prove the visit',
      description: 'Attach photos, notes, chemistry, and technician context before details disappear.',
    },
    {
      icon: WifiOff,
      title: 'Work offline',
      description: 'Keep logging in backyards, service alleys, and weak-signal neighborhoods.',
    },
    {
      icon: Receipt,
      title: 'Send the report',
      description: 'Turn completed service into customer-ready summaries and billing follow-up.',
    },
  ];

  const workflow = [
    'Plan the route before trucks roll',
    'Log photos, chemicals, and notes poolside',
    'Review work orders and weekly reports',
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6fbfc] text-slate-950">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(8,145,178,0.18),transparent_28%),radial-gradient(circle_at_85%_18%,rgba(14,116,144,0.12),transparent_24%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_52%,#f8fbfc_100%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.05] [background-image:linear-gradient(rgba(15,23,42,0.75)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.75)_1px,transparent_1px)] [background-size:44px_44px]" />

      <header className="px-4 pt-4 sm:px-6 lg:px-8">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between rounded-2xl border border-white/70 bg-white/75 px-4 shadow-[0_18px_60px_-42px_rgba(8,47,73,0.9)] backdrop-blur-xl sm:px-5">
          <Link to="/landing" className="flex items-center gap-3" aria-label="ChemCheck home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-[0_14px_34px_-18px_rgba(8,145,178,0.9)]">
              <Droplets className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight text-slate-950">ChemCheck</span>
          </Link>

          <div className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#workflow" className="transition-colors hover:text-cyan-700">
              Workflow
            </a>
            <a href="#field-app" className="transition-colors hover:text-cyan-700">
              Field app
            </a>
            <Link to="/pricing" className="transition-colors hover:text-cyan-700">
              Pricing
            </Link>
          </div>

          <Button
            asChild
            className="h-10 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_16px_34px_-24px_rgba(15,23,42,0.95)] hover:bg-cyan-700 focus-visible:ring-2 focus-visible:ring-cyan-500"
          >
            <Link to="/signup">Start free</Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="px-4 pb-20 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pb-28">
          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center rounded-full border border-cyan-200 bg-white/80 px-4 py-2 text-sm font-semibold text-cyan-800 shadow-sm">
                Built for pool routes, photos, and reports
              </div>
              <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[0.96] tracking-[-0.055em] text-slate-950 sm:text-6xl lg:text-7xl">
                Pool routes, service proof, and billing in one field app.
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-lg leading-8 text-slate-600">
                Plan the day, capture visit proof, and send reports before the truck leaves the curb.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-full bg-cyan-600 px-6 text-base font-semibold text-white shadow-[0_18px_36px_-20px_rgba(8,145,178,0.95)] hover:bg-cyan-700 focus-visible:ring-2 focus-visible:ring-cyan-500"
                >
                  <Link to="/signup">
                    Start free
                    <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-full border-slate-300 bg-white/80 px-6 text-base font-semibold text-slate-800 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800"
                >
                  <Link to="/pricing">View pricing</Link>
                </Button>
              </div>

              <dl className="mt-10 grid max-w-xl grid-cols-3 gap-3 text-sm">
                {[
                  ['Routes', 'daily plan'],
                  ['Photos', 'visit proof'],
                  ['Reports', 'ready fast'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur">
                    <dt className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{label}</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div id="field-app" className="relative">
              <div
                className="absolute -left-6 top-10 h-56 w-56 rounded-full bg-cyan-200/50 blur-3xl"
                aria-hidden="true"
              />
              <div
                className="absolute -bottom-8 right-6 h-44 w-44 rounded-full bg-teal-200/50 blur-3xl"
                aria-hidden="true"
              />
              <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-slate-950 p-3 shadow-[0_28px_80px_-38px_rgba(8,47,73,0.9)]">
                <div
                  className="absolute inset-0 opacity-30"
                  style={{
                    backgroundImage: "url('/chemcheck-pool-proof.webp')",
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  aria-hidden="true"
                />
                <div className="relative grid gap-3 lg:grid-cols-[0.86fr_1fr]">
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5 text-white backdrop-blur-md">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-cyan-100">Sample field view</p>
                      <Smartphone className="h-5 w-5 text-cyan-100" aria-hidden="true" />
                    </div>
                    <div className="mt-8 rounded-[1.35rem] bg-white p-4 text-slate-950">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Next stop</p>
                          <h2 className="mt-1 text-xl font-semibold tracking-tight">Parkside HOA</h2>
                        </div>
                        <MapPin className="h-6 w-6 text-cyan-600" aria-hidden="true" />
                      </div>
                      <div className="mt-5 space-y-3 text-sm">
                        {['Gate code saved', 'Salt cell photo needed', 'Invoice draft ready'].map((item) => (
                          <div key={item} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                            <CheckCircle className="h-4 w-4 text-cyan-600" aria-hidden="true" />
                            <span className="font-medium text-slate-700">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-[1.5rem] border border-white/10 bg-white/90 p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-500">Crew route</p>
                          <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Clean stops. Clear proof.</h3>
                        </div>
                        <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                          <Route className="h-6 w-6" aria-hidden="true" />
                        </div>
                      </div>
                      <div className="mt-6 grid gap-3 sm:grid-cols-3">
                        {['Route', 'Log', 'Report'].map((step) => (
                          <div key={step} className="rounded-2xl bg-slate-950 p-4 text-white">
                            <p className="font-semibold">{step}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[1.5rem] border border-white/10 bg-cyan-500 p-5 text-white">
                      <p className="text-sm font-semibold text-cyan-50">Offline-ready</p>
                      <p className="mt-3 max-w-md text-2xl font-semibold leading-tight tracking-tight">
                        Keep the service record moving even when the signal drops.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="workflow" className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <h2 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
                The daily pool route, tightened.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                ChemCheck keeps the office plan, field notes, and customer report in one clean workflow.
              </p>
            </div>

            <div className="mt-12 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="grid gap-5 sm:grid-cols-2">
                {valueProps.map((prop, index) => (
                  <article
                    key={prop.title}
                    className={`group min-h-64 rounded-[1.75rem] border border-white/80 p-6 shadow-[0_24px_70px_-50px_rgba(8,47,73,0.75)] transition duration-300 hover:-translate-y-1 ${
                      index === 0
                        ? 'bg-slate-950 text-white sm:col-span-2'
                        : 'bg-white/80 text-slate-950 backdrop-blur'
                    }`}
                  >
                    <div
                      className={`mb-8 flex h-12 w-12 items-center justify-center rounded-2xl ${
                        index === 0 ? 'bg-cyan-400 text-slate-950' : 'bg-cyan-50 text-cyan-700'
                      }`}
                    >
                      <prop.icon className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <h3 className="text-2xl font-semibold tracking-tight">{prop.title}</h3>
                    <p className={`mt-3 max-w-lg leading-7 ${index === 0 ? 'text-cyan-50' : 'text-slate-600'}`}>
                      {prop.description}
                    </p>
                  </article>
                ))}
              </div>

              <aside className="overflow-hidden rounded-[1.75rem] border border-white/80 bg-white shadow-[0_24px_70px_-50px_rgba(8,47,73,0.75)]">
                <div
                  className="h-72 bg-cover bg-center"
                  style={{
                    backgroundImage: "url('/chemcheck-pool-proof.webp')",
                  }}
                  aria-hidden="true"
                />
                <div className="p-6">
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-950">Built around field reality.</h3>
                  <ul className="mt-5 space-y-3">
                    {workflow.map((item) => (
                      <li key={item} className="flex gap-3 text-slate-700">
                        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600" aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 rounded-[2rem] border border-cyan-100 bg-white/85 p-6 shadow-[0_24px_80px_-55px_rgba(8,47,73,0.85)] backdrop-blur lg:grid-cols-[0.9fr_1.1fr] lg:p-10">
            <div>
              <h2 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
                Cleaner handoff from route to revenue.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                The app gives technicians a focused route flow, then gives the business the record it needs for reports and billing.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  className="h-12 rounded-full bg-cyan-600 px-6 text-base font-semibold text-white hover:bg-cyan-700"
                >
                  <Link to="/signup">Start free</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 rounded-full border-slate-300 bg-white px-6 text-base font-semibold text-slate-800 hover:border-cyan-300 hover:bg-cyan-50"
                >
                  <Link to="/pricing">View pricing</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ['Plan', 'Route order and customer context stay visible.'],
                ['Capture', 'Photos, chemicals, and notes stay with the visit.'],
                ['Close', 'Reports and billing have the record they need.'],
              ].map(([title, body]) => (
                <div key={title} className="rounded-[1.5rem] bg-slate-950 p-5 text-white">
                  <p className="text-xl font-semibold tracking-tight">{title}</p>
                  <p className="mt-4 text-sm leading-6 text-cyan-50">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="px-4 pb-8 pt-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-[1.5rem] border border-white/80 bg-white/75 p-5 text-sm text-slate-600 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <Link to="/landing" className="flex items-center gap-3 text-slate-950" aria-label="ChemCheck home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-600 text-white">
              <Droplets className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="font-semibold tracking-tight">ChemCheck</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-5">
            <Link to="/support" className="hover:text-cyan-700">
              Help
            </Link>
            <a href="/privacy-policy.html" className="hover:text-cyan-700">
              Privacy
            </a>
            <a href="/terms-of-service.html" className="hover:text-cyan-700">
              Terms
            </a>
          </nav>
          <p>© {new Date().getFullYear()} ChemCheck</p>
        </div>
      </footer>
    </div>
  );
}
