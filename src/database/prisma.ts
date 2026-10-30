import { PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger';
import { dbQueryDurationHistogram } from '../observability/metrics';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

// Measure query performance
prisma.$on('query' as never, (e: { query: string; params: string; duration: number }) => {
  dbQueryDurationHistogram.observe(
    { operation: 'query', model: 'database' },
    e.duration / 1000
  );
  logger.trace({ query: e.query, durationMs: e.duration }, 'Database Query');
});

prisma.$on('error' as never, (e: { message: string }) => {
  logger.error({ err: e.message }, 'Database Error');
});

