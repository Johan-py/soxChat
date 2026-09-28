/**
 * Tests for Phase (d): security headers and hardening.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import securityHeaders from './security.js';
import { RateLimiter } from './ratelimit.js';

describe('Security headers', () => {
  let app: Fastify.FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(securityHeaders);
    app.get('/test', async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets Content-Security-Policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('sets Strict-Transport-Security', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    const hsts = res.headers['strict-transport-security'];
    expect(hsts).toBeDefined();
    expect(hsts).toContain('max-age=31536000');
    expect(hsts).toContain('includeSubDomains');
  });

  it('sets X-Content-Type-Options', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets Referrer-Policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sets X-Frame-Options', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets Permissions-Policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    const pp = res.headers['permissions-policy'];
    expect(pp).toBeDefined();
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
  });

  it('removes X-Powered-By', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CSP disallows inline scripts', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});

describe('Error handling', () => {
  let app: Fastify.FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(securityHeaders);
    app.setErrorHandler((error, request, reply) => {
      reply.code(500).send({ error: 'INTERNAL_ERROR' });
    });
    app.get('/error', async () => {
      throw new Error('Secret internal detail');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not leak internal error details', async () => {
    const res = await app.inject({ method: 'GET', url: '/error' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.error).not.toContain('Secret');
    expect(res.body).not.toContain('Secret internal detail');
  });
});

describe('Rate limiting', () => {
  let app: Fastify.FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(securityHeaders);

    const limiter = new RateLimiter(3, 60_000); // 3 requests per minute

    app.get('/limited', async (request, reply) => {
      const clientIp = request.ip ?? request.socket.remoteAddress ?? 'unknown';
      if (!limiter.isAllowed(clientIp)) {
        return reply.code(429).send({ error: 'RATE_LIMITED' });
      }
      return { ok: true };
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests under limit', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/limited' });
    const res2 = await app.inject({ method: 'GET', url: '/limited' });
    const res3 = await app.inject({ method: 'GET', url: '/limited' });
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res3.statusCode).toBe(200);
  });

  it('blocks requests over limit', async () => {
    // Previous test used 3 requests, this should be blocked
    const res = await app.inject({ method: 'GET', url: '/limited' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('RATE_LIMITED');
  });
});
