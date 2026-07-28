import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  Camera,
  Droplets,
  FileText,
  FlaskConical,
  Route,
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

function TileLabel({ index, label, icon: Icon }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-data text-xs uppercase tracking-[0.2em] text-ink-muted">
        {index} / {label}
      </span>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
    </div>
  );
}

function BentoTile({ index, label, icon, title, description, img, className = '' }) {
  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-sheet border border-line bg-surface-1 transition duration-300 hover:-translate-y-1 hover:border-[var(--status-info-line)] ${className}`}
    >
      <div className="p-6 sm:p-7">
        <TileLabel index={index} label={label} icon={icon} />
        <h3 className="mt-6 text-2xl font-semibold tracking-tight text-ink">{title}</h3>
        <p className="mt-2 max-w-md leading-7 text-ink-secondary">{description}</p>
      </div>
      {img && (
        <div className="mt-auto border-t border-line bg-surface-2/50 px-6 pt-6 sm:px-7">
          <div className="relative mx-auto h-52 w-full max-w-[300px] overflow-hidden rounded-t-2xl border border-b-0 border-line bg-surface-0 sm:h-60">
            <img
              src={img.src}
              width={img.width}
              height={img.height}
              alt={img.alt}
              loading="lazy"
              className={`absolute inset-0 h-full w-full object-cover ${img.position}`}
            />
          </div>
        </div>
      )}
    </article>
  );
}

export default function LandingPage() {
  useEffect(() => {
    document.title = 'ChemCheck - Pool Service, Logged and Proved';
    updateMeta(
      'description',
      'ChemCheck helps pool service professionals plan routes, capture visit proof, and manage reports in one mobile app.'
    );
  }, []);

  return (
    <div className="dark min-h-screen overflow-x-hidden bg-surface-0 text-ink">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_15%_8%,rgba(34,178,216,0.16),transparent_30%),radial-gradient(circle_at_85%_18%,rgba(34,178,216,0.1),transparent_26%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.05] [background-image:linear-gradient(rgba(226,240,255,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(226,240,255,0.9)_1px,transparent_1px)] [background-size:44px_44px]" />

      <header className="px-4 pt-4 sm:px-6 lg:px-8">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between rounded-2xl border border-line bg-surface-1/70 px-4 shadow-card backdrop-blur sm:px-5">
          <Link to="/landing" className="flex items-center gap-3" aria-label="ChemCheck home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-surface-0">
              <Droplets className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight text-ink">ChemCheck</span>
          </Link>

          <div className="hidden items-center gap-7 text-sm font-medium text-ink-secondary md:flex">
            <a href="#field-app" className="transition-colors hover:text-brand-ink">
              Field app
            </a>
            <Link to="/pricing" className="transition-colors hover:text-brand-ink">
              Pricing
            </Link>
          </div>

          <Button
            asChild
            className="h-10 rounded-full bg-brand px-5 text-sm font-semibold text-surface-0 hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Link to="/signup">Start free</Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="px-4 pb-16 pt-16 sm:px-6 sm:pt-24 lg:px-8 lg:pb-24">
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center rounded-full border border-line bg-surface-1 px-4 py-2 text-sm font-semibold text-brand-ink">
                Built for pool service pros
              </div>
              <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[0.96] tracking-[-0.055em] text-ink sm:text-6xl lg:text-7xl">
                Run the route.
                <span className="block text-brand-ink">Prove the work.</span>
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-lg leading-8 text-ink-secondary">
                ChemCheck plans the day&apos;s stops, logs chemistry and photos poolside, and turns
                every visit into a customer-ready report — even with zero bars.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-full bg-brand px-6 text-base font-semibold text-surface-0 hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-ring"
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
                  className="h-12 rounded-full border-line bg-surface-1 px-6 text-base font-semibold text-ink hover:bg-surface-2 hover:text-ink"
                >
                  <Link to="/pricing">View pricing</Link>
                </Button>
              </div>

              <p className="mt-10 font-data text-xs uppercase tracking-[0.2em] text-ink-muted">
                Routes · Chemistry · Photos · Reports
              </p>
            </div>

            <div className="relative">
              <div
                className="absolute -inset-8 -z-10 rounded-full bg-brand/20 blur-3xl"
                aria-hidden="true"
              />
              <div className="relative mx-auto w-full max-w-[320px] transition-transform duration-500 ease-standard lg:rotate-[1.5deg] lg:hover:rotate-0">
                <div className="overflow-hidden rounded-[2.75rem] border border-line bg-surface-1 p-2.5 shadow-raised">
                  <div className="overflow-hidden rounded-[2.25rem]">
                    <img
                      src="/marketing/02-service-log.jpg"
                      width={390}
                      height={2253}
                      alt="ChemCheck service log on a phone: quick-select chemistry readings for pH, chlorine, alkalinity, and stabilizer"
                      className="h-[520px] w-full object-cover object-[center_34%] sm:h-[580px]"
                    />
                  </div>
                </div>
              </div>
              <p className="mt-5 text-center font-data text-xs uppercase tracking-[0.2em] text-ink-muted">
                Actual app screens, unretouched
              </p>
            </div>
          </div>
        </section>

        <section id="field-app" className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <h2 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
                The whole visit, in one app.
              </h2>
              <p className="mt-5 text-lg leading-8 text-ink-secondary">
                Every screen below is the real field app — the same one your crew carries poolside.
              </p>
            </div>

            <div className="mt-12 grid gap-5 lg:grid-cols-12">
              <BentoTile
                index="01"
                label="Chemistry"
                icon={FlaskConical}
                title="One-tap chemistry readings."
                description="pH, chlorine, alkalinity, and stabilizer logged poolside with quick-select levels or exact numeric entry."
                img={{
                  src: '/marketing/02-service-log.jpg',
                  width: 390,
                  height: 2253,
                  alt: 'Service log chemistry section with Good selected for pH, chlorine, alkalinity, and stabilizer',
                  position: 'object-[center_33%]',
                }}
                className="lg:col-span-7"
              />
              <BentoTile
                index="02"
                label="Route"
                icon={Route}
                title="Routes that plan themselves."
                description="Optimized stop order with time estimates, generated from your saved customer list before the trucks roll."
                img={{
                  src: '/marketing/10-generated-route.jpg',
                  width: 390,
                  height: 1102,
                  alt: 'Generated route plan showing total stops, estimated time, and the first stop with navigate button',
                  position: 'object-[center_42%]',
                }}
                className="lg:col-span-5"
              />
              <BentoTile
                index="03"
                label="Proof"
                icon={Camera}
                title="Proof at every stop."
                description="Before and after photos captured in the app and pinned to the visit record."
                img={{
                  src: '/marketing/02-service-log.jpg',
                  width: 390,
                  height: 2253,
                  alt: 'Before photos section of the service log with capture photo button',
                  position: 'object-[center_15%]',
                }}
                className="lg:col-span-4"
              />
              <article className="group flex flex-col rounded-sheet border border-line bg-surface-1 p-6 transition duration-300 hover:-translate-y-1 hover:border-[var(--status-info-line)] sm:p-7 lg:col-span-4">
                <TileLabel index="04" label="Offline" icon={WifiOff} />
                <h3 className="mt-6 text-2xl font-semibold tracking-tight text-ink">
                  Zero bars. Zero lost logs.
                </h3>
                <p className="mt-2 max-w-md leading-7 text-ink-secondary">
                  Every reading, photo, and note queues on the device and syncs when signal returns.
                </p>
                <p className="mt-auto pt-8 font-data text-4xl tracking-tight text-brand-ink">
                  100% offline-capable
                </p>
              </article>
              <article className="group flex flex-col rounded-sheet border border-line bg-surface-1 p-6 transition duration-300 hover:-translate-y-1 hover:border-[var(--status-info-line)] sm:p-7 lg:col-span-4">
                <TileLabel index="05" label="Reports" icon={FileText} />
                <h3 className="mt-6 text-2xl font-semibold tracking-tight text-ink">
                  Reports that send themselves.
                </h3>
                <p className="mt-2 max-w-md leading-7 text-ink-secondary">
                  Branded visit summaries delivered to customers by SMS or email after each service.
                </p>
                <p className="mt-auto pt-8 font-data text-4xl tracking-tight text-brand-ink">
                  SMS + email
                </p>
              </article>

              <article className="group overflow-hidden rounded-sheet border border-line bg-surface-1 transition duration-300 hover:-translate-y-1 hover:border-[var(--status-info-line)] lg:col-span-12">
                <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="p-6 sm:p-7 lg:p-10">
                    <TileLabel index="06" label="The day" icon={Droplets} />
                    <h3 className="mt-6 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                      The whole day at a glance.
                    </h3>
                    <p className="mt-3 max-w-lg leading-7 text-ink-secondary">
                      Today&apos;s stops, completion counts, and missed-visit alerts on one screen —
                      the daily ops brief your crew opens first.
                    </p>
                    <div className="mt-8">
                      <Button
                        asChild
                        className="h-11 rounded-full bg-brand px-6 text-sm font-semibold text-surface-0 hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Link to="/signup">
                          Start free
                          <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-end justify-center border-t border-line bg-surface-2/50 px-6 pt-6 lg:border-l lg:border-t-0 lg:pt-10">
                    <div className="relative h-56 w-full max-w-[300px] overflow-hidden rounded-t-2xl border border-b-0 border-line bg-surface-0 lg:h-64">
                      <img
                        src="/marketing/01-home-route.jpg"
                        width={390}
                        height={899}
                        alt="ChemCheck home screen showing Today's Route with missed-visit alert and daily stats"
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover object-[center_24%]"
                      />
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl rounded-sheet border border-line bg-surface-1 p-8 text-center sm:p-12 lg:p-16">
            <p className="font-data text-xs uppercase tracking-[0.2em] text-ink-muted">
              Routes · Chemistry · Photos · Reports
            </p>
            <h2 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
              Ready when the truck is.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-ink-secondary">
              Start free and run tomorrow&apos;s route in ChemCheck.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-brand px-6 text-base font-semibold text-surface-0 hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-ring"
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
                className="h-12 rounded-full border-line bg-surface-2 px-6 text-base font-semibold text-ink hover:bg-surface-2/70 hover:text-ink"
              >
                <Link to="/pricing">View pricing</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-sheet border border-line bg-surface-1/70 p-5 text-sm text-ink-secondary backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <Link to="/landing" className="flex items-center gap-3 text-ink" aria-label="ChemCheck home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-surface-0">
              <Droplets className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="font-semibold tracking-tight">ChemCheck</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-5">
            <Link to="/support" className="hover:text-brand-ink">
              Help
            </Link>
            <a href="/privacy-policy.html" className="hover:text-brand-ink">
              Privacy
            </a>
            <a href="/terms-of-service.html" className="hover:text-brand-ink">
              Terms
            </a>
          </nav>
          <p>© {new Date().getFullYear()} ChemCheck</p>
        </div>
      </footer>
    </div>
  );
}
