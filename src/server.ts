import 'reflect-metadata';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './observability/logger';
import { prisma } from './database/prisma';
import { redisClient } from './database/redis';

const startServer = async () => {
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 Amrutam Telemedicine Backend running at http://localhost:${env.PORT}/${env.API_PREFIX}`);
    logger.info(`📚 Swagger UI documentation available at http://localhost:${env.PORT}/docs`);
    logger.info(`📊 Prometheus metrics available at http://localhost:${env.PORT}/metrics`);
  });

  // Graceful Shutdown Handler
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);

    server.close(async () => {
      logger.info('HTTP server closed.');

      try {
        await prisma.$disconnect();
        logger.info('PostgreSQL connection closed.');
      } catch (err) {
        logger.error({ err }, 'Error closing PostgreSQL connection');
      }

      try {
        await redisClient.quit();
        logger.info('Redis connection closed.');
      } catch (err) {
        logger.error({ err }, 'Error closing Redis connection');
      }

      logger.info('Graceful shutdown completed.');
      process.exit(0);
    });

    // Force exit if shutdown takes too long (e.g. 10s timeout)
    setTimeout(() => {
      logger.error('Graceful shutdown timed out. Forcing process exit.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startServer().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

