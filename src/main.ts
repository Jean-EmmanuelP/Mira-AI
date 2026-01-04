import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import dotenv from 'dotenv';
import { connectMongoDB } from './config/mongodb';
import { QdrantService } from './shared/qdrant.service';
import { messageRoutes } from './modules/messages/message.routes';
import { memoryRoutes } from './modules/memory/memory.routes';
import { profileRoutes } from './modules/profile/profile.routes';
import { onboardingRoutes } from './modules/onboarding/onboarding.routes';
import { activityRoutes } from './modules/activity/activity.routes';
import { reminderRoutes } from './modules/reminders/reminder.routes';
import { StatsService } from './monitoring/stats.service';
import { GradiumService } from './shared/gradium.service';
import { HumeService } from './shared/hume.service';

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

// Initialize services
const gradiumService = new GradiumService();
const humeService = new HumeService();

async function registerPlugins() {
  await app.register(cors, { origin: '*' });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max for audio files
    },
  });
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

  // Users endpoint - list distinct userIds
  app.get('/api/v1/users', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const Message = (await import('./database/schemas/message.schema')).Message;
      const users = await Message.distinct('userId');
      // Filter out test users and invalid names (starting with / or empty)
      return {
        users: users.filter((u: string) =>
          u &&
          !u.startsWith('test-') &&
          !u.startsWith('/') &&
          u.trim().length > 0
        )
      };
    } catch (error) {
      return { users: [] };
    }
  });

  // Delete user endpoint - removes all user data
  app.delete('/api/v1/users/:userId', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.params as { userId: string };
      if (!userId) return reply.status(400).send({ error: 'userId required' });

      const Message = (await import('./database/schemas/message.schema')).Message;
      const SemanticMemory = (await import('./database/schemas/memory.schema')).SemanticMemory;
      const Goal = (await import('./database/schemas/goal.schema')).Goal;
      const EmotionalProfile = (await import('./database/schemas/emotional-profile.schema')).EmotionalProfile;
      const Onboarding = (await import('./database/schemas/onboarding.schema')).Onboarding;
      const Event = (await import('./database/schemas/event.schema')).Event;
      const UserActivity = (await import('./database/schemas/user-activity.schema')).UserActivity;
      const MiraProfile = (await import('./database/schemas/mira-profile.schema')).MiraProfile;

      // Delete all user data from all collections
      const [messages, memories, goals, profile, onboarding, events, activities, miraProfile] = await Promise.all([
        Message.deleteMany({ userId }),
        SemanticMemory.deleteMany({ userId }),
        Goal.deleteMany({ userId }),
        EmotionalProfile.deleteMany({ userId }),
        Onboarding.deleteMany({ userId }),
        Event.deleteMany({ userId }),
        UserActivity.deleteMany({ userId }),
        MiraProfile.deleteMany({ userId })
      ]);

      // Also clear from Qdrant vector DB
      try {
        const qdrant = new QdrantService();
        await qdrant.deleteByUserId(userId);
      } catch (e) {
        console.warn('Could not clear Qdrant vectors:', e);
      }

      console.log(`🗑️ Deleted user ${userId}: ${messages.deletedCount} messages, ${memories.deletedCount} memories, ${events.deletedCount} events, ${activities.deletedCount} activities`);

      return {
        success: true,
        deleted: {
          messages: messages.deletedCount,
          memories: memories.deletedCount,
          goals: goals.deletedCount,
          profile: profile.deletedCount,
          onboarding: onboarding.deletedCount,
          events: events.deletedCount,
          activities: activities.deletedCount,
          miraProfile: miraProfile.deletedCount
        }
      };
    } catch (error) {
      console.error('Delete user error:', error);
      return reply.status(500).send({ error: 'Failed to delete user' });
    }
  });

  // API test endpoint
  app.get('/api/v1/test', async (req: FastifyRequest, reply: FastifyReply) => {
    return { message: 'Mira API is running', version: '1.0.0' };
  });

  // Register module routes
  await app.register(messageRoutes, { prefix: '/api/v1/messages' });
  await app.register(memoryRoutes, { prefix: '/api/v1/memories' });
  await app.register(profileRoutes, { prefix: '/api/v1/profile' });
  await app.register(onboardingRoutes, { prefix: '/api/v1/onboarding' });
  await app.register(activityRoutes, { prefix: '/api/v1/activity' });
  await app.register(reminderRoutes, { prefix: '/api/v1/reminders' });

  // Root POST /chat - supports both text and audio
  app.post('/chat', async (req: FastifyRequest, reply: FastifyReply) => {
    const MessageService = (await import('./modules/messages/message.service')).MessageService;
    const service = new MessageService();

    let userId: string;
    let conversationId: string;
    let messageContent: string;
    let lang: 'en' | 'fr' = 'fr';
    let isAudioInput = false;
    let emotionContext: string | null = null;

    // Check if this is a multipart request (audio upload)
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      // Handle audio input
      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: 'No audio file provided' });
      }

      // Get form fields
      const fields = data.fields as any;
      userId = fields.userId?.value || fields.user_id?.value;
      conversationId = fields.conversationId?.value || fields.conversation_id?.value || `conv-${Date.now()}`;
      lang = fields.lang?.value === 'en' ? 'en' : 'fr';

      if (!userId) {
        return reply.status(400).send({ error: 'Missing userId in form data' });
      }

      // Convert audio to text using STT
      if (!gradiumService.isEnabled()) {
        return reply.status(503).send({ error: 'Speech-to-text service not configured' });
      }

      try {
        const startTime = Date.now();
        console.log(`🎤 Audio received, processing...`);

        const audioBuffer = await data.toBuffer();
        const audioBase64 = audioBuffer.toString('base64');
        const inputFormat = data.mimetype?.includes('wav') ? 'wav' : 'pcm';
        console.log(`📦 Audio buffer: ${audioBuffer.length} bytes, format: ${inputFormat}`);

        // Start STT and emotion analysis in parallel
        console.log(`⏳ Starting STT...`);
        const [transcription, emotionAnalysis] = await Promise.all([
          gradiumService.speechToText(audioBase64, inputFormat),
          humeService.isEnabled() ? humeService.analyzeEmotionsFromBuffer(audioBuffer) : Promise.resolve(null)
        ]);
        console.log(`✅ STT completed in ${Date.now() - startTime}ms`);

        messageContent = transcription;
        isAudioInput = true;

        if (!messageContent) {
          return reply.status(400).send({ error: 'Could not transcribe audio' });
        }

        console.log(`🎤 STT: "${messageContent}"`);

        // Format emotion context for LLM if available
        if (emotionAnalysis) {
          emotionContext = humeService.formatForPrompt(emotionAnalysis);
          console.log(`🎭 Emotion: ${emotionAnalysis.dominantEmotion} (${Math.round(emotionAnalysis.intensity * 100)}%)`);
        }
      } catch (error) {
        console.error('STT error:', error);
        return reply.status(500).send({ error: 'Speech-to-text failed' });
      }
    } else {
      // Handle JSON text input
      const body = req.body as any;
      userId = body.userId || body.user_id;
      conversationId = body.conversationId || body.conversation_id || `conv-${Date.now()}`;
      messageContent = body.content || body.message;
      lang = body.lang === 'en' ? 'en' : 'fr';

      if (!userId || !messageContent) {
        return reply.status(400).send({ error: 'Missing required fields: userId, content/message' });
      }
    }

    // Process the message with emotion context and language if available
    const llmStartTime = Date.now();
    console.log(`🧠 Processing message...`);
    const response = await service.processMessage(userId, conversationId, messageContent, emotionContext, lang);
    console.log(`✅ LLM response in ${Date.now() - llmStartTime}ms`);

    // Calculate realistic typing delay based on response length
    // Average typing speed: 38-40 words per minute = ~1.5 seconds per word
    const calculateTypingDelay = (text: string): number => {
      const wordCount = text.trim().split(/\s+/).length;
      const baseDelayPerWord = 1500; // ms
      let delay = wordCount * baseDelayPerWord;
      // Add randomness (±20%)
      const randomFactor = 0.8 + Math.random() * 0.4;
      delay = delay * randomFactor;
      // Add thinking delay (0.5-2 seconds)
      const thinkingDelay = 500 + Math.random() * 1500;
      delay += thinkingDelay;
      // Cap between 1 and 15 seconds
      delay = Math.max(1000, Math.min(delay, 15000));
      return Math.round(delay);
    };

    const typingDelay = calculateTypingDelay(response.content);

    // Decide if we should send audio response
    // Only respond with audio if the user sent audio input
    let audioResponse: string | null = null;
    const shouldSendAudio = isAudioInput && gradiumService.isEnabled();

    if (shouldSendAudio) {
      try {
        const ttsStartTime = Date.now();
        console.log(`🔊 Generating TTS...`);
        audioResponse = await gradiumService.textToSpeech(response.content);
        console.log(`✅ TTS completed in ${Date.now() - ttsStartTime}ms`);
      } catch (error) {
        console.error('TTS error:', error);
        // Continue without audio, not a fatal error
      }
    }

    return {
      success: true,
      response: response.content,
      conversationId: conversationId,
      inputType: isAudioInput ? 'audio' : 'text',
      typingDelay, // Frontend should wait this long before displaying response
      // Audio response (base64) - only present when user sent audio
      ...(audioResponse && {
        audioResponse: audioResponse,
        audioFormat: 'wav',
      }),
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
    console.log(`   POST /chat - Send a message to Mira (text or audio)`);
    console.log(`        - JSON: { userId, message } → text response`);
    console.log(`        - Multipart: audio file + userId → text + ~25% audio response`);
    console.log(`   POST /api/v1/messages/chat - Full message endpoint`);
    console.log(`   GET  /api/v1/memories?userId=xxx - Get user memories`);
    console.log(`   GET  /api/v1/profile/:userId - Get user profile`);
    console.log(`   GET  /health - Health check`);
    console.log(`   GET  /api/v1/stats - System stats`);
    console.log(`\n🎤 Audio: ${gradiumService.isEnabled() ? 'Enabled (Gradium STT/TTS)' : 'Disabled (no GRADIUM_API_KEY)'}`);
    console.log(`🎭 Emotions: ${humeService.isEnabled() ? 'Enabled (Hume AI Prosody)' : 'Disabled (no HUME_AI_API_KEY)'}\n`);
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

start();

export { app };
