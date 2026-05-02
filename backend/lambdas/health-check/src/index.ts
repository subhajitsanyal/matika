import { handler as healthHandler } from './handler';

// Lambda entry point — GET /health
export const handler = healthHandler;
