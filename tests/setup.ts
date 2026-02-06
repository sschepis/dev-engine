// =============================================================================
// OpenClaw DevEngine - Test Setup
// =============================================================================

import { jest } from '@jest/globals';

// Increase timeout for async operations
jest.setTimeout(10000);

// Suppress console output during tests unless explicitly enabled
const originalConsole = { ...console };

beforeAll(() => {
  if (process.env.DEBUG !== 'true') {
    console.log = jest.fn();
    console.debug = jest.fn();
    console.info = jest.fn();
    // Keep warn and error for debugging test failures
  }
});

afterAll(() => {
  console.log = originalConsole.log;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
});

// Global test utilities
declare global {
  var testUtils: {
    delay: (ms: number) => Promise<void>;
    randomString: (length: number) => string;
  };
}

globalThis.testUtils = {
  delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  randomString: (length: number) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
};
