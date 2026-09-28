/**
 * CORS configuration for cross-origin requests.
 *
 * Needed when frontend (Vercel) and backend (Render) are on different domains.
 * WebSocket connections are not affected by CORS.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const corsPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (request, reply) => {
    // Allow the frontend origin
    reply.header('Access-Control-Allow-Origin', request.headers.origin ?? '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.header('Access-Control-Allow-Credentials', 'true');
  });

  // Handle preflight
  app.options('/api/rooms', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', request.headers.origin ?? '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.code(204).send();
  });
};

export default fp(corsPlugin, { name: 'cors' });
