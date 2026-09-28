/**
 * Security headers plugin for Fastify.
 *
 * Sets strict security headers on all HTTP responses:
 * - Content-Security-Policy: no inline scripts, no external resources
 * - Strict-Transport-Security: enforce HTTPS
 * - X-Content-Type-Options: no MIME sniffing
 * - Referrer-Policy: no referrer
 * - X-Frame-Options: no framing
 * - Permissions-Policy: restrict browser features
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const securityHeaders: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (request, reply) => {
    // CSP: no inline scripts, no external resources, only self
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );

    // HSTS: enforce HTTPS for 1 year (only effective over HTTPS)
    reply.header(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );

    // Prevent MIME sniffing
    reply.header('X-Content-Type-Options', 'nosniff');

    // No referrer
    reply.header('Referrer-Policy', 'no-referrer');

    // No framing (redundant with CSP frame-ancestors but for older browsers)
    reply.header('X-Frame-Options', 'DENY');

    // Restrict browser features
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );

    // Remove server identification
    reply.removeHeader('X-Powered-By');
  });
};

export default fp(securityHeaders, { name: 'security-headers' });
