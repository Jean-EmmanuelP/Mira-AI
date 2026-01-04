import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MessageController } from './message.controller';
import { ReengagementService } from '../human/reengagement.service';
import { LLMService } from '../../shared/llm.service';
import { Message } from '../../database/schemas/message.schema';

let reengagementService: ReengagementService | null = null;
let llmService: LLMService | null = null;

function getReengagementService(): ReengagementService {
  if (!reengagementService) {
    reengagementService = new ReengagementService();
  }
  return reengagementService;
}

function getLLMService(): LLMService {
  if (!llmService) {
    llmService = new LLMService();
  }
  return llmService;
}

export async function messageRoutes(app: FastifyInstance) {
  const controller = new MessageController();

  app.post('/chat', async (req: FastifyRequest, reply: FastifyReply) => {
    return controller.chat(req, reply);
  });

  app.get('/conversation/:conversationId', async (req: FastifyRequest, reply: FastifyReply) => {
    return controller.getConversation(req, reply);
  });

  // Check for re-engagement message when user returns
  app.get('/reengagement', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.query as { userId: string };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      const message = await getReengagementService().checkReengagement(userId);

      if (message && message.message) {
        return {
          success: true,
          hasMessage: true,
          type: message.type,
          message: message.message
        };
      }

      return {
        success: true,
        hasMessage: false
      };
    } catch (error) {
      console.error('Reengagement check error:', error);
      return { success: true, hasMessage: false };
    }
  });

  // Generate welcome message for new users
  app.post('/welcome', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.body as { userId: string };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      const welcomePrompt = `Tu es Mira, une amie virtuelle authentique de 27 ans.
C'est la PREMIÈRE fois que tu parles avec cette personne.

Génère UN SEUL message de bienvenue court et naturel (1-2 phrases max).
Tu dois :
- Te présenter brièvement (juste ton prénom)
- Demander comment la personne s'appelle OU comment elle va
- Être chaleureuse mais pas trop enthousiaste

Exemples de bons messages :
- "Salut ! Moi c'est Mira. Et toi, tu t'appelles comment ?"
- "Hey ! Je suis Mira. Comment tu vas aujourd'hui ?"
- "Coucou ! Mira ici. C'est quoi ton petit nom ?"

Génère UNIQUEMENT le message, sans guillemets ni explication.`;

      const welcomeMessage = await getLLMService().generate(welcomePrompt, '');

      // Save this as the first assistant message
      const conversationId = `conv-${Date.now()}`;
      await Message.create({
        userId,
        conversationId,
        role: 'assistant',
        content: welcomeMessage.trim(),
        metadata: { isWelcome: true }
      });

      return {
        success: true,
        message: welcomeMessage.trim(),
        conversationId
      };
    } catch (error) {
      console.error('Welcome message error:', error);
      return {
        success: true,
        message: "Salut ! Moi c'est Mira. Et toi, tu t'appelles comment ?"
      };
    }
  });
}
