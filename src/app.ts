import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env';
import { logger } from './observability/logger';
import { requestIdMiddleware } from './middlewares/request-id.middleware';
import { errorMiddleware, NotFoundError } from './middlewares/error.middleware';
import { healthRoutes } from './modules/health/health.routes';
import { HealthController } from './modules/health/health.controller';

export const createApp = (): Application => {
  const app = express();

  // 1. Security Headers (OWASP)
  app.use(helmet());

  // 2. CORS
  app.use(cors());

  // 3. Body Parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 4. Request ID & Metrics tracking
  app.use(requestIdMiddleware);

  // 5. Structured HTTP Request Logging
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).id || 'unknown',
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        ignore: (req) => req.url?.includes('/health') || req.url?.includes('/metrics'),
      },
    })
  );

  // 6. Prometheus Scrape Endpoint
  app.get('/metrics', HealthController.metrics);
  app.get(`/${env.API_PREFIX}/metrics`, HealthController.metrics);

  // 7. Interactive OpenAPI / Swagger UI Documentation
  const openApiPath = path.resolve(process.cwd(), 'docs/openapi.yaml');
  if (fs.existsSync(openApiPath)) {
    try {
      const openApiFile = fs.readFileSync(openApiPath, 'utf8');
      const swaggerDocument = YAML.parse(openApiFile);
      app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
      logger.info('Swagger documentation mounted at /docs');
    } catch (err) {
      logger.warn({ err }, 'Failed to parse openapi.yaml for Swagger UI');
    }
  }

  // 8. API Routes
  app.use(`/${env.API_PREFIX}/health`, healthRoutes);

  // Root welcome route
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: env.APP_NAME,
      version: '1.0.0',
      status: 'HEALTHY',
      documentation: '/docs',
      metrics: '/metrics',
      apiBase: `/${env.API_PREFIX}`,
    });
  });

  // 9. 404 Route Handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Endpoint ${req.method} ${req.originalUrl} not found`));
  });

  // 10. Global Error Handling Middleware (RFC 7807)
  app.use(errorMiddleware);

  return app;
};

