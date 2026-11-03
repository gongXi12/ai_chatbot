import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

function importConfig(env: NodeJS.ProcessEnv): string {
  return execFileSync(
    process.execPath,
    ['--import', 'tsx', '--eval', "await import('./src/config/unifiedConfig.ts')"],
    {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

describe('unified config production guards', () => {
  it('rejects ephemeral memory storage in production', () => {
    expect(() => importConfig({ NODE_ENV: 'production', STORAGE_DRIVER: 'memory' }))
      .toThrow(/Production requires STORAGE_DRIVER=postgres/u);
  });

  it('rejects a weak configured admin token in production', () => {
    expect(() => importConfig({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'postgres',
      ADMIN_TOKEN: 'short',
    })).toThrow(/ADMIN_TOKEN/u);
  });

  it('rejects a missing or weak HTTP chat token in production', () => {
    expect(() => importConfig({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'postgres',
      ADMIN_TOKEN: '',
      CHAT_API_TOKEN: 'short',
    })).toThrow(/CHAT_API_TOKEN/u);
  });

  it('allows production PostgreSQL with the admin console disabled', () => {
    expect(importConfig({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'postgres',
      ADMIN_TOKEN: '',
      CHAT_API_TOKEN: 'a-secure-chat-token-with-at-least-32-chars',
    })).toBe('');
  });
});