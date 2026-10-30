import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('api/v1'),
  APP_NAME: z.string().default('amrutam-telemedicine-backend'),

  // PostgreSQL
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.coerce.number().default(5432),
  DATABASE_USER: z.string().default('postgres'),
  DATABASE_PASSWORD: z.string().default('postgres_secure_password'),
  DATABASE_NAME: z.string().default('amrutam_telemedicine'),
  DATABASE_URL: z.string().default(
    'postgresql://postgres:postgres_secure_password@localhost:5432/amrutam_telemedicine?schema=public'
  ),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT & Security
  JWT_SECRET: z.string().min(16).default('super_secret_jwt_access_token_key_amrutam_2026_at_least_32_chars'),
  JWT_EXPIRATION: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16).default('super_secret_jwt_refresh_token_key_amrutam_2026_at_least_32_chars'),
  JWT_REFRESH_EXPIRATION: z.string().default('7d'),
  MFA_SERVICE_NAME: z.string().default('AmrutamTelemedicine'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),

  // Observability
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

const parseEnv = () => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
  }
  return parsed.data;
};

export const env = parseEnv();
export type Environment = z.infer<typeof envSchema>;

