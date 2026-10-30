import 'reflect-metadata';
import { container } from 'tsyringe';
import { prisma } from '../database/prisma';
import { redisClient } from '../database/redis';
import { logger } from '../observability/logger';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Logger } from 'pino';

// Register injection tokens
export const TOKENS = {
  PrismaClient: Symbol('PrismaClient'),
  RedisClient: Symbol('RedisClient'),
  Logger: Symbol('Logger'),
};

export const setupContainer = (): void => {
  container.register<PrismaClient>(TOKENS.PrismaClient, { useValue: prisma });
  container.register<Redis>(TOKENS.RedisClient, { useValue: redisClient });
  container.register<Logger>(TOKENS.Logger, { useValue: logger });
};

setupContainer();

export { container };

