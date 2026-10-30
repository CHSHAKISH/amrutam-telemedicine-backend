import { Request, Response } from 'express';
import { prisma } from '../../database/prisma';
import { redisClient } from '../../database/redis';
import { register } from '../../observability/metrics';

export class HealthController {
  public static async liveness(_req: Request, res: Response): Promise<void> {
    res.status(200).json({
      status: 'UP',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  public static async readiness(_req: Request, res: Response): Promise<void> {
    const checks: Record<string, string> = {
      database: 'DOWN',
      redis: 'DOWN',
    };

    let isHealthy = true;

    // Check PostgreSQL
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'UP';
    } catch {
      isHealthy = false;
    }

    // Check Redis
    try {
      const pong = await redisClient.ping();
      if (pong === 'PONG') {
        checks.redis = 'UP';
      } else {
        isHealthy = false;
      }
    } catch {
      isHealthy = false;
    }

    const statusCode = isHealthy ? 200 : 503;
    res.status(statusCode).json({
      status: isHealthy ? 'READY' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      services: checks,
    });
  }

  public static async metrics(_req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', register.contentType);
    const metricsData = await register.metrics();
    res.send(metricsData);
  }
}

