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
      className={`overflow-hidden rounded-[1.35rem] border bg-white/85 backdrop-blur transition-colors ${
        open ? 'border-cyan-200 shadow-[0_18px_46px_-38px_rgba(8,145,178,0.55)]' : 'border-white/80 shadow-sm'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold tracking-[-0.015em] text-slate-950">{question}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-cyan-700 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="border-t border-slate-200/70 px-5 pb-4 pt-3 text-sm leading-6 text-slate-600">
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
    <div className="relative min-h-screen overflow-hidden bg-[#f6fbfc] text-slate-950">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />

      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8 text-center sm:mb-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800 shadow-sm">
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Help center
          </span>
          <div className="mx-auto mt-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
            <HelpCircle className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
            Help &amp; Support
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            Have a question or need help? Send us a message and we will get back to you as soon as possible.
          </p>
        </header>

        <div className="grid gap-5 lg:grid-cols-5">
          <section
            className="rounded-[1.75rem] border border-white/80 bg-white/85 p-5 shadow-[0_24px_70px_-50px_rgba(8,47,73,0.75)] backdrop-blur sm:p-7 lg:col-span-3"
            aria-label="Contact support"
          >
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
              </span>
              <h2 className="text-lg font-semibold tracking-[-0.025em] text-slate-950">Contact us</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="support-name" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Name
                </label>
                <input
                  id="support-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Your name"
                  className="block h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                />
              </div>
              <div>
                <label htmlFor="support-email" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Email
                </label>
                <input
                  id="support-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="you@example.com"
                  className="block h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                />
              </div>
              <div>
                <label htmlFor="support-message" className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Message
                </label>
                <textarea
                  id="support-message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                  placeholder="How can we help you?"
                  className="block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-cyan-600 px-5 text-sm font-semibold text-white shadow-[0_18px_38px_-24px_rgba(8,145,178,0.95)] transition-colors hover:bg-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Email support
              </button>
            </form>
          </section>

          <aside
            className="h-fit rounded-[1.75rem] border border-white/80 bg-white/85 p-5 shadow-[0_24px_70px_-50px_rgba(8,47,73,0.75)] backdrop-blur sm:p-7 lg:col-span-2"
            aria-label="Quick links"
          >
            <h2 className="text-lg font-semibold tracking-[-0.025em] text-slate-950">Quick links</h2>
            <div className="mt-4 space-y-1.5">
              <a
                href="mailto:support@chemcheck.xyz"
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-100 hover:bg-cyan-50/60 hover:text-cyan-900"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                </span>
                support@chemcheck.xyz
              </a>
              <a
                href="/privacy-policy.html"
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-100 hover:bg-cyan-50/60 hover:text-cyan-900"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                </span>
                Privacy policy
              </a>
              <a
                href="/terms-of-service.html"
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-100 hover:bg-cyan-50/60 hover:text-cyan-900"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </span>
                Terms of service
              </a>
              <Link
                to="/pricing"
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-100 hover:bg-cyan-50/60 hover:text-cyan-900"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                  <HelpCircle className="h-4 w-4" aria-hidden="true" />
                </span>
                Pricing &amp; plans
              </Link>
            </div>
          </aside>
        </div>

        <section className="mt-10" aria-label="Frequently asked questions">
          <h2 className="text-balance text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">
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