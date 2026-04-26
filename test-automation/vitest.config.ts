import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 60_000,
    include: [
      'e2e/**/*.test.ts',
      'integration/**/*.test.ts',
      'multilingual/**/*.test.ts',
      'compliance/**/*.test.ts',
    ],
    reporters: ['verbose', 'json'],
    outputFile: {
      json: './results/journey-results/test-results.json',
    },
    pool: 'forks',
    sequence: {
      concurrent: false,
    },
  },
  resolve: {
    alias: {
      '@helpers': path.resolve(__dirname, 'e2e/helpers'),
      '@e2e': path.resolve(__dirname, 'e2e'),
      '@integration': path.resolve(__dirname, 'integration'),
      '@multilingual': path.resolve(__dirname, 'multilingual'),
      '@performance': path.resolve(__dirname, 'performance'),
      '@compliance': path.resolve(__dirname, 'compliance'),
    },
  },
});
