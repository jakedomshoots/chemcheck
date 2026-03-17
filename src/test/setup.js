import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Create a proper localStorage mock class
class LocalStorageMock {
  constructor() {
    this.store = {};
  }

  getItem(key) {
    return this.store[key] || null;
  }

  setItem(key, value) {
    this.store[key] = String(value);
  }

  removeItem(key) {
    delete this.store[key];
  }

  clear() {
    this.store = {};
  }

  get length() {
    return Object.keys(this.store).length;
  }

  key(index) {
    return Object.keys(this.store)[index] || null;
  }
}

// Create instances
const localStorageMock = new LocalStorageMock();
const sessionStorageMock = new LocalStorageMock();

// Define on global and window
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

Object.defineProperty(global, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
});

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

class IntersectionObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

// Mock observers with constructor-safe classes for Radix/Floating UI
global.ResizeObserver = ResizeObserverMock;
window.ResizeObserver = ResizeObserverMock;
global.IntersectionObserver = IntersectionObserverMock;
window.IntersectionObserver = IntersectionObserverMock;

// Mock scrollTo
window.scrollTo = vi.fn();

// Reset mocks before each test
beforeEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
});
