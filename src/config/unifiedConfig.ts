import 'dotenv/config';
import { z } from 'zod';

const optionalUrl = z.string().url().or(z.literal('')).default('');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MODEL_PROVIDER: z.enum(['echo', 'openai-compatible']).default('echo'),
  STORAGE_DRIVER: z.enum(['memory', 'postgres']).default('memory'),
  DATABASE_URL: z.string().default('postgres://companion:companion@127.0.0.1:5432/companion'),
  OPENAI_COMPATIBLE_BASE_URL: optionalUrl,
  OPENAI_COMPATIBLE_API_KEY: z.string().default(''),
  OPENAI_COMPATIBLE_MODEL: z.string().default(''),
  SENTRY_DSN: optionalUrl,
  ADMIN_TOKEN: z.string().default(''),
  CHAT_API_TOKEN: z.string().default(''),
  WEIXIN_ACCOUNT_ID: z.string().default(''),
  WEIXIN_BOT_TOKEN: z.string().default(''),
  WEIXIN_BASE_URL: z.string().url().default('https://ilinkai.weixin.qq.com'),
  COMPANION_AUTO_AFFECTION: z.string().default('false').transform((value) =>
    ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())),
});

const env = schema.parse(process.env);

if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER !== 'postgres') {
  throw new Error('Production requires STORAGE_DRIVER=postgres.');
}
if (env.NODE_ENV === 'production' && env.ADMIN_TOKEN) {
  if (env.ADMIN_TOKEN.length < 32 || /^replace-with-/u.test(env.ADMIN_TOKEN)) {
    throw new Error('Production ADMIN_TOKEN must be a non-placeholder value with at least 32 characters.');
  }
}if (env.NODE_ENV === 'production') {
  if (env.CHAT_API_TOKEN.length < 32 || /^replace-with-/u.test(env.CHAT_API_TOKEN)) {
    throw new Error('Production CHAT_API_TOKEN must be a non-placeholder value with at least 32 characters.');
  }
}

export const config = {
  environment: env.NODE_ENV,
  server: {
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
  },
  storage: {
    driver: env.STORAGE_DRIVER,
    databaseUrl: env.DATABASE_URL,
  },
  admin: {
    token: env.ADMIN_TOKEN,
  },
  chatApi: {
    token: env.CHAT_API_TOKEN,
  },
  companion: {
    autoAffection: env.COMPANION_AUTO_AFFECTION,
  },
  model: {
    provider: env.MODEL_PROVIDER,
    baseUrl: env.OPENAI_COMPATIBLE_BASE_URL,
    apiKey: env.OPENAI_COMPATIBLE_API_KEY,
    model: env.OPENAI_COMPATIBLE_MODEL,
  },
  sentry: {
    dsn: env.SENTRY_DSN,
  },
  weixin: {
    accountId: env.WEIXIN_ACCOUNT_ID,
    botToken: env.WEIXIN_BOT_TOKEN,
    baseUrl: env.WEIXIN_BASE_URL,
  },
} as const;
