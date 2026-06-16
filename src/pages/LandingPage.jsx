import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Route, ClipboardList, Receipt, ArrowRight, CheckCircle } from 'lucide-react';

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
      'ChemCheck helps pool service professionals plan routes, log service visits with photos, and manage billing and reports — all in one mobile app.'
    );
  }, []);

  const valueProps = [
    {
      icon: Route,
      title: 'Smart Route Planning',
      description:
        'Optimize your daily route so you spend less time driving and more time servicing pools.',
    },
    {
      icon: ClipboardList,
      title: 'Service Logs & Photos',
      description:
        'Capture detailed service records and photo proof-of-service for every visit, online or offline.',
    },
    {
      icon: Receipt,
      title: 'Billing & Reports',
      description:
        'Generate weekly reports, track invoices, and keep your business finances organized.',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50">
      {/* Hero */}
      <section className="px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl shadow-lg mb-8">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-8 h-8 text-white"
            >
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z" />
            </svg>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight mb-6">
            ChemCheck
          </h1>
          <p className="text-xl sm:text-2xl text-slate-600 mb-8 max-w-2xl mx-auto">
            The modern mobile app for pool service professionals. Plan routes, log services, and get paid faster.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <Link to="/signup">
              <Button
                size="lg"
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-8 py-6 text-lg rounded-xl shadow-md"
              >
                Get Started Free
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link to="/pricing">
              <Button
                size="lg"
                variant="outline"
                className="px-8 py-6 text-lg rounded-xl border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                View Pricing
              </Button>
            </Link>
          </div>

          {/* App Store badge placeholder */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-3 px-5 py-3 bg-slate-900 text-white rounded-xl shadow-lg">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.84-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              <div className="text-left">
                <div className="text-xs text-slate-300">Download on the</div>
                <div className="text-lg font-semibold leading-none">App Store</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="px-4 sm:px-6 lg:px-8 py-16 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Built for pool pros</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Everything you need to run your pool service business from your phone.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {valueProps.map((prop) => (
              <Card key={prop.title} className="p-6 hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 bg-cyan-50 rounded-xl flex items-center justify-center mb-4">
                  <prop.icon className="w-6 h-6 text-cyan-600" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-2">{prop.title}</h3>
                <p className="text-slate-600">{prop.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Screenshots */}
      <section className="px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">See ChemCheck in action</h2>
            <p className="text-lg text-slate-600">A clean, fast experience designed for the field.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="aspect-[9/19] bg-gradient-to-br from-cyan-100 to-cyan-200 rounded-3xl shadow-inner flex items-center justify-center">
              <span className="text-cyan-800 font-medium">Route Plan</span>
            </div>
            <div className="aspect-[9/19] bg-gradient-to-br from-blue-100 to-blue-200 rounded-3xl shadow-inner flex items-center justify-center">
              <span className="text-blue-800 font-medium">Service Log</span>
            </div>
            <div className="aspect-[9/19] bg-gradient-to-br from-slate-200 to-slate-300 rounded-3xl shadow-inner flex items-center justify-center">
              <span className="text-slate-700 font-medium">Billing Report</span>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="px-4 sm:px-6 lg:px-8 py-16 bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">Simple, transparent pricing</h2>
          <p className="text-lg text-slate-300 mb-8 max-w-2xl mx-auto">
            Start with a 14-day free trial. No credit card required. Pick the plan that fits your business.
          </p>
          <ul className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-slate-300 mb-10">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-cyan-400" />
              14-day free trial
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-cyan-400" />
              Cancel anytime
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-cyan-400" />
              All features included
            </li>
          </ul>
          <Link to="/pricing">
            <Button
              size="lg"
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-8 py-6 text-lg rounded-xl"
            >
              View Plans
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 sm:px-6 lg:px-8 py-12 bg-white border-t border-slate-200">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-4 h-4 text-white"
              >
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z" />
              </svg>
            </div>
            <span className="font-bold text-slate-900">ChemCheck</span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-slate-600">
            <Link to="/support" className="hover:text-cyan-600 transition-colors">
              Help & Support
            </Link>
            <a
              href="/privacy-policy.html"
              className="hover:text-cyan-600 transition-colors"
            >
              Privacy Policy
            </a>
            <a
              href="/terms-of-service.html"
              className="hover:text-cyan-600 transition-colors"
            >
              Terms of Service
            </a>
          </nav>
          <p className="text-sm text-slate-500">© {new Date().getFullYear()} ChemCheck</p>
        </div>
      </footer>
    </div>
  );
}
