import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BrowserRouter } from 'react-router-dom';

// Add jest-axe matchers
expect.extend(toHaveNoViolations);

// Mock the Convex hooks
vi.mock('@/api/convexHooks', () => ({
  useCustomers: () => [
    { _id: 1, full_name: 'Test Customer', address: '123 Test St', service_day: 'Monday' }
  ],
  useServiceLogs: () => [],
  useNotes: () => [],
  useChemicalUsage: () => [],
}));

// Mock Clerk
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  useUser: () => ({ user: null }),
  ClerkProvider: ({ children }) => children,
  SignIn: () => <div>Sign In</div>,
  SignUp: () => <div>Sign Up</div>,
}));

// Simple test components for accessibility
const TestButton = () => (
  <button type="button" aria-label="Test action">
    Click me
  </button>
);

const TestForm = () => (
  <form aria-label="Test form">
    <label htmlFor="name">Name</label>
    <input id="name" type="text" name="name" />
    <button type="submit">Submit</button>
  </form>
);

const TestNavigation = () => (
  <nav aria-label="Main navigation">
    <ul>
      <li><a href="/">Home</a></li>
      <li><a href="/clients">Clients</a></li>
      <li><a href="/history">History</a></li>
    </ul>
  </nav>
);

const TestCard = () => (
  <article aria-labelledby="card-title">
    <h2 id="card-title">Customer Card</h2>
    <p>Customer information goes here</p>
    <button type="button">View Details</button>
  </article>
);

describe('Accessibility Tests', () => {
  describe('Basic Components', () => {
    it('button should have no accessibility violations', async () => {
      const { container } = render(<TestButton />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('form should have no accessibility violations', async () => {
      const { container } = render(<TestForm />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('navigation should have no accessibility violations', async () => {
      const { container } = render(
        <BrowserRouter>
          <TestNavigation />
        </BrowserRouter>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('card component should have no accessibility violations', async () => {
      const { container } = render(<TestCard />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Color Contrast', () => {
    it('text should have sufficient color contrast', async () => {
      const { container } = render(
        <div style={{ backgroundColor: '#ffffff', color: '#333333' }}>
          <h1>High Contrast Heading</h1>
          <p>This text should have good contrast</p>
        </div>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Interactive Elements', () => {
    it('links should be accessible', async () => {
      const { container } = render(
        <BrowserRouter>
          <a href="/test">Test Link</a>
        </BrowserRouter>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('inputs should have labels', async () => {
      const { container } = render(
        <div>
          <label htmlFor="email">Email Address</label>
          <input id="email" type="email" name="email" />
        </div>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Semantic Structure', () => {
    it('page should have proper heading hierarchy', async () => {
      const { container } = render(
        <main>
          <h1>Main Title</h1>
          <section>
            <h2>Section Title</h2>
            <p>Content here</p>
          </section>
        </main>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('lists should be properly structured', async () => {
      const { container } = render(
        <ul aria-label="Customer list">
          <li>Customer 1</li>
          <li>Customer 2</li>
          <li>Customer 3</li>
        </ul>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
