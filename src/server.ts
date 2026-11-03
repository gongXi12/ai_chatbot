import './instrument.js';
import { config } from './config/unifiedConfig.js';
import { createRuntime } from './runtime/createRuntime.js';

async function main(): Promise<void> {
  let app: Awaited<ReturnType<typeof createRuntime>>['app'] | undefined;
  let closing = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app?.log.info({ signal }, 'shutting down');
    await app?.close();
  };

  try {
    ({ app } = await createRuntime());
    process.once('SIGINT', () => { void shutdown('SIGINT'); });
    process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
    await app.listen({ host: config.server.host, port: config.server.port });
  } catch (error) {
    if (app) {
      app.log.error(error);
      await app.close().catch((closeError: unknown) => app?.log.error(closeError));
    } else {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    }
    process.exitCode = 1;
  }
}

await main();