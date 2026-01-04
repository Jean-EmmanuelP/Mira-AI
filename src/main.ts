import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import dotenv from 'dotenv';
import { connectMongoDB } from './config/mongodb';
import { QdrantService } from './shared/qdrant.service';
import { messageRoutes } from './modules/messages/message.routes';
import { memoryRoutes } from './modules/memory/memory.routes';
import { profileRoutes } from './modules/profile/profile.routes';
import { StatsService } from './monitoring/stats.service';

dotenv.config();

const app: FastifyInstance = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  },
});

async function registerPlugins() {
  await app.register(cors, { origin: '*' });
  await app.register(helmet, { contentSecurityPolicy: false });
}

async function registerRoutes() {
  // Health check
  app.get('/health', async (req: FastifyRequest, reply: FastifyReply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Stats endpoint
  app.get('/api/v1/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    return StatsService.getInstance().getStats();
  });

  // API test endpoint
  app.get('/api/v1/test', async (req: FastifyRequest, reply: FastifyReply) => {
    return { message: 'Mira API is running', version: '1.0.0' };
  });

  // Register module routes
  await app.register(messageRoutes, { prefix: '/api/v1/messages' });
  await app.register(memoryRoutes, { prefix: '/api/v1/memories' });
  await app.register(profileRoutes, { prefix: '/api/v1/profile' });

  // Root POST /chat for simple access
  app.post('/chat', async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, conversationId, content, message } = req.body as any;

    // Support both 'content' and 'message' fields
    const messageContent = content || message;

    if (!userId || !messageContent) {
      return reply.status(400).send({ error: 'Missing required fields: userId, content/message' });
    }

    // Forward to message controller
    const MessageService = (await import('./modules/messages/message.service')).MessageService;
    const service = new MessageService();
    const convId = conversationId || `conv-${Date.now()}`;

    const response = await service.processMessage(userId, convId, messageContent);

    return {
      success: true,
      response: response.content,
      conversationId: convId,
    };
  });
}

// Error handling
app.setErrorHandler((error, request, reply) => {
  app.log.error(error);
  StatsService.getInstance().recordError();
  reply.status(500).send({ error: 'Internal server error' });
});

// Startup
async function start() {
  try {
    console.log('🚀 Starting Mira API...\n');

    // Connect MongoDB
    await connectMongoDB();

    // Initialize Qdrant
    const qdrant = new QdrantService();
    await qdrant.ensureCollection();

    // Register plugins and routes
    await registerPlugins();
    await registerRoutes();

    const PORT = parseInt(process.env.PORT || '3000');
    await app.listen({ port: PORT, host: '0.0.0.0' });

    console.log(`\n✅ Mira API running on http://localhost:${PORT}`);
    console.log(`\n📝 Endpoints:`);
    console.log(`   POST /chat - Send a message to Mira`);
    console.log(`   POST /api/v1/messages/chat - Full message endpoint`);
    console.log(`   GET  /api/v1/memories?userId=xxx - Get user memories`);
    console.log(`   GET  /api/v1/profile/:userId - Get user profile`);
    console.log(`   GET  /health - Health check`);
    console.log(`   GET  /api/v1/stats - System stats\n`);
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

start();

export { app };
