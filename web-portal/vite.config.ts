/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    global: 'globalThis',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-aws': ['aws-amplify', '@aws-amplify/ui-react'],
          'vendor-charts': ['chart.js', 'react-chartjs-2'],
          'patient-tabs': [
            './src/components/patient/ProtocolTab.tsx',
            './src/components/patient/RecommendationsTab.tsx',
            './src/components/patient/InteractionsTab.tsx',
            './src/components/patient/TranscriptViewer.tsx',
            './src/components/patient/ParameterConfigForm.tsx',
            './src/components/patient/RecommendationForm.tsx',
            './src/components/patient/ThresholdOverrideForm.tsx',
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
