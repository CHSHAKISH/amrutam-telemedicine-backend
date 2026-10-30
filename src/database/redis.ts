import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../observability/logger';

export const createRedisClient = (): Redis => {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
    lazyConnect: true,
  });

  redis.on('connect', () => {
    logger.info('Connected to Redis');
  });

  redis.on('error', (err) => {
    logger.warn({ err }, 'Redis connection warning/error');
  });

  return redis;
};

export const redisClient = createRedisClient();

