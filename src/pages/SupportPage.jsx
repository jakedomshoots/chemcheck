import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Mail, MessageSquare, HelpCircle, FileText, Shield } from 'lucide-react';

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50 py-12 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-cyan-100 rounded-2xl mb-4">
            <HelpCircle className="w-7 h-7 text-cyan-600" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">Help & Support</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Have a question or need help? Send us a message and we will get back to you as soon as possible.
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Contact form */}
          <Card className="lg:col-span-3 p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-6">
              <MessageSquare className="w-5 h-5 text-cyan-600" />
              <h2 className="text-xl font-semibold text-slate-900">Contact Us</h2>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <Label htmlFor="support-name" className="text-slate-700">
                  Name
                </Label>
                <Input
                  id="support-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Your name"
                  className="mt-1.5 rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="support-email" className="text-slate-700">
                  Email
                </Label>
                <Input
                  id="support-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="you@example.com"
                  className="mt-1.5 rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="support-message" className="text-slate-700">
                  Message
                </Label>
                <Textarea
                  id="support-message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                  placeholder="How can we help you?"
                  className="mt-1.5 rounded-lg"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white rounded-lg"
              >
                <Mail className="w-4 h-4 mr-2" />
                Email Support
              </Button>
            </form>
          </Card>

          {/* Quick links */}
          <Card className="lg:col-span-2 p-6 sm:p-8 h-fit">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">Quick Links</h2>
            <div className="space-y-3">
              <a
                href="mailto:support@chemcheck.xyz"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
              >
                <Mail className="w-5 h-5 text-cyan-600" />
                <span>support@chemcheck.xyz</span>
              </a>
              <a
                href="/privacy-policy.html"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
              >
                <Shield className="w-5 h-5 text-cyan-600" />
                <span>Privacy Policy</span>
              </a>
              <a
                href="/terms-of-service.html"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
              >
                <FileText className="w-5 h-5 text-cyan-600" />
                <span>Terms of Service</span>
              </a>
              <Link
                to="/pricing"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
              >
                <HelpCircle className="w-5 h-5 text-cyan-600" />
                <span>Pricing & Plans</span>
              </Link>
            </div>
          </Card>
        </div>

        {/* FAQ */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-8">Frequently Asked Questions</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {faqs.map((faq) => (
              <Card key={faq.question} className="p-6">
                <h3 className="font-semibold text-slate-900 mb-2">{faq.question}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{faq.answer}</p>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
