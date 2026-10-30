import { Request, Response, NextFunction } from 'express';
import { logger } from '../observability/logger';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errorType: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, errorType = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.errorType = errorType;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource Not Found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource Conflict / Slot Already Booked', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class RateLimitExceededError extends AppError {
  constructor(message = 'Rate limit exceeded, please retry later') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// Global Error Handler conforming to RFC 7807 Problem Details
export const errorMiddleware = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const errorType = isAppError ? err.errorType : 'INTERNAL_SERVER_ERROR';
  const message = isAppError ? err.message : 'An unexpected internal error occurred';
  const details = isAppError ? err.details : undefined;

  // Log error with correlation ID
  logger.error(
    {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      statusCode,
      errorType,
      message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    },
    `HTTP Exception: ${message}`
  );

  res.status(statusCode).json({
    type: `https://api.amrutam.co.in/errors/${errorType.toLowerCase().replace(/_/g, '-')}`,
    title: errorType,
    status: statusCode,
    detail: message,
    instance: req.originalUrl,
    requestId: req.id,
    timestamp: new Date().toISOString(),
    ...(details ? { details } : {}),
  });
};

