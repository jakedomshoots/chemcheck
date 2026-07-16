import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageSquare, HelpCircle, FileText, Shield, ChevronDown } from 'lucide-react';

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

const faqs = [
  {
    question: 'How do I get started with ChemCheck?',
    answer:
      'Sign up for a free account, add your first few customers, and start logging service visits. Our setup wizard will walk you through the basics.',
  },
  {
    question: 'Can I use ChemCheck without an internet connection?',
    answer:
      'Yes. ChemCheck stores your data locally and syncs automatically when you are back online, so you can keep working in the field.',
  },
  {
    question: 'How do I manage my subscription or billing?',
    answer:
      'Visit the Billing section in the app or go to the Pricing page to start, upgrade, or cancel your plan at any time.',
  },
  {
    question: 'Is my customer data secure?',
    answer:
      'We use industry-standard encryption and secure cloud storage. Your data is backed up and only accessible from your account.',
  },
];

function FaqItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`overflow-hidden rounded-raised border bg-surface-1 transition-colors ${
        open ? 'border-[var(--status-info-line)] shadow-cta' : 'border-line shadow-sm'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold tracking-[-0.015em] text-ink">{question}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-brand-ink transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="border-t border-line px-5 pb-4 pt-3 text-sm leading-6 text-ink-secondary">
          {answer}
        </div>
      ) : null}
    </div>
  );
}

export default function SupportPage() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });

  useEffect(() => {
    document.title = 'Help & Support - ChemCheck';
    updateMeta(
      'description',
      'Get help with ChemCheck. Contact our support team, browse FAQs, and review our Privacy Policy and Terms of Service.'
    );
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent('ChemCheck Support Request');
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\n\nMessage:\n${form.message}`
    );
    window.location.href = `mailto:support@chemcheck.xyz?subject=${subject}&body=${body}`;
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface-0 text-ink">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />

      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8 text-center sm:mb-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--status-info-line)] bg-surface-1 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink shadow-sm">
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Help center
          </span>
          <div className="mx-auto mt-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-softer text-brand-ink">
            <HelpCircle className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
            Help &amp; Support
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-ink-secondary sm:text-base">
            Have a question or need help? Send us a message and we will get back to you as soon as possible.
          </p>
        </header>

        <div className="grid gap-5 lg:grid-cols-5">
          <section
            className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-7 lg:col-span-3"
            aria-label="Contact support"
          >
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-softer text-brand-ink">
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
              </span>
              <h2 className="text-lg font-semibold tracking-[-0.025em] text-ink">Contact us</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="support-name" className="mb-1.5 block text-sm font-semibold text-ink">
                  Name
                </label>
                <input
                  id="support-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Your name"
                  className="block h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm text-ink placeholder:text-ink-muted transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label htmlFor="support-email" className="mb-1.5 block text-sm font-semibold text-ink">
                  Email
                </label>
                <input
                  id="support-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="you@example.com"
                  className="block h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm text-ink placeholder:text-ink-muted transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label htmlFor="support-message" className="mb-1.5 block text-sm font-semibold text-ink">
                  Message
                </label>
                <textarea
                  id="support-message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                  placeholder="How can we help you?"
                  className="block w-full rounded-2xl border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white shadow-cta transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Email support
              </button>
            </form>
          </section>

          <aside
            className="h-fit rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-7 lg:col-span-2"
            aria-label="Quick links"
          >
            <h2 className="text-lg font-semibold tracking-[-0.025em] text-ink">Quick links</h2>
            <div className="mt-4 space-y-1.5">
              <a
                href="mailto:support@chemcheck.xyz"
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-medium text-ink-secondary transition-colors hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-softer text-brand-ink">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                </span>
                support@chemcheck.xyz
              </a>
              <a
                href="/privacy-policy.html"
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-medium text-ink-secondary transition-colors hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-softer text-brand-ink">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                </span>
                Privacy policy
              </a>
              <a
                href="/terms-of-service.html"
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-medium text-ink-secondary transition-colors hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-softer text-brand-ink">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </span>
                Terms of service
              </a>
              <Link
                to="/pricing"
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-medium text-ink-secondary transition-colors hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-softer text-brand-ink">
                  <HelpCircle className="h-4 w-4" aria-hidden="true" />
                </span>
                Pricing &amp; plans
              </Link>
            </div>
          </aside>
        </div>

        <section className="mt-10" aria-label="Frequently asked questions">
          <h2 className="text-balance text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {faqs.map((faq) => (
              <FaqItem key={faq.question} question={faq.question} answer={faq.answer} />
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}