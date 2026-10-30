import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { httpRequestCounter, httpRequestDurationHistogram } from '../observability/metrics';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      startTime?: [number, number];
    }
  }
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incomingId = req.headers['x-request-id'] as string;
  const requestId = incomingId || randomUUID();

  req.id = requestId;
  req.startTime = process.hrtime();
  res.setHeader('X-Request-ID', requestId);

  // Monitor request metrics upon response completion
  res.on('finish', () => {
    if (req.startTime) {
      const diff = process.hrtime(req.startTime);
      const durationSeconds = diff[0] + diff[1] / 1e9;

      // Extract route pattern (e.g., /api/v1/doctors/:id) if available, fallback to path
      const route = req.baseUrl || req.route?.path || req.path || 'unknown';
      const statusCode = res.statusCode.toString();
      const method = req.method;

      httpRequestCounter.inc({ method, route, status_code: statusCode });
      httpRequestDurationHistogram.observe({ method, route, status_code: statusCode }, durationSeconds);
    }
  });

  next();
};

