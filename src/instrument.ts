import * as Sentry from '@sentry/node';
import { config } from './config/unifiedConfig.js';

if (config.sentry.dsn) {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.environment,
    tracesSampleRate: config.environment === 'production' ? 0.1 : 1,
  });
}

export { Sentry };
