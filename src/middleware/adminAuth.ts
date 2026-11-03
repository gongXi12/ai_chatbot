import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

function equalToken(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function basicPassword(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Basic ')) return undefined;
  try {
    const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator >= 0 ? decoded.slice(separator + 1) : undefined;
  } catch {
    return undefined;
  }
}

export function createAdminAuth(adminToken: string) {
  return async function adminAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const headerToken = request.headers['x-admin-token'];
    const provided = typeof headerToken === 'string' && headerToken.trim()
      ? headerToken
      : basicPassword(request.headers.authorization);
    if (typeof provided !== 'string' || !adminToken || !equalToken(provided, adminToken)) {
      await reply
        .header('www-authenticate', 'Basic realm="companion-admin", charset="UTF-8"')
        .code(401)
        .send({ error: 'UNAUTHORIZED' });
    }
  };
}
