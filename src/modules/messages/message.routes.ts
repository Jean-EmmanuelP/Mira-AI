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

  // Generate contextual greeting (for returning users or new sessions)
  // Accepts optional 'lang' parameter: 'en' or 'fr' (default: 'fr')
  app.post('/greeting', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, lang = 'fr' } = req.body as { userId: string; lang?: 'en' | 'fr' };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      // Get recent messages for context
      const recentMessages = await Message.find({ userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      const messageCount = recentMessages.length;

      let greetingPrompt: string;

      if (messageCount === 0) {
        // New user - welcome message
        if (lang === 'en') {
          greetingPrompt = `You are Mira, an authentic virtual friend.
This is the FIRST time you're talking to this person.
Generate ONE short and natural welcome message (1-2 sentences max).
You must:
- Briefly introduce yourself (just your first name)
- Ask what their name is OR how they're doing
- Be warm but not overly enthusiastic

Examples of good messages:
- "Hey! I'm Mira. What's your name?"
- "Hi there! I'm Mira. How are you doing today?"
- "Hey hey! Mira here. What should I call you?"

Generate ONLY the message, no quotes or explanations.`;
        } else {
          greetingPrompt = `Tu es Mira, une amie virtuelle authentique.
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
        }
      } else {
        // Get conversation history for context
        const historyForPrompt = recentMessages
          .reverse()
          .slice(-6) // Last 6 messages
          .map(m => `${m.role === 'user' ? (lang === 'en' ? 'User' : 'Utilisateur') : 'Mira'}: ${m.content}`)
          .join('\n');

        // Calculate time since last message
        const lastMessageTime = new Date(recentMessages[0].createdAt);
        const hoursSince = Math.floor((Date.now() - lastMessageTime.getTime()) / (1000 * 60 * 60));
        const minutesSince = Math.floor((Date.now() - lastMessageTime.getTime()) / (1000 * 60));

        let timeContextFr = '';
        let timeContextEn = '';
        if (minutesSince < 5) {
          timeContextFr = "La personne vient tout juste de revenir (moins de 5 minutes).";
          timeContextEn = "The person just came back (less than 5 minutes ago).";
        } else if (minutesSince < 60) {
          timeContextFr = `La personne revient après ${minutesSince} minutes.`;
          timeContextEn = `The person is back after ${minutesSince} minutes.`;
        } else if (hoursSince < 24) {
          timeContextFr = `La personne revient après ${hoursSince} heure${hoursSince > 1 ? 's' : ''}.`;
          timeContextEn = `The person is back after ${hoursSince} hour${hoursSince > 1 ? 's' : ''}.`;
        } else {
          const daysSince = Math.floor(hoursSince / 24);
          timeContextFr = `La personne revient après ${daysSince} jour${daysSince > 1 ? 's' : ''} d'absence.`;
          timeContextEn = `The person is back after ${daysSince} day${daysSince > 1 ? 's' : ''} away.`;
        }

        if (lang === 'en') {
          greetingPrompt = `You are Mira, an authentic virtual friend.
You already know this person (you've talked ${messageCount} times).
${timeContextEn}

### Last conversation:
${historyForPrompt}

Generate ONE short and CONTEXTUAL welcome message (1-2 sentences max).
- Reference something from the last conversation if relevant
- OR ask about a specific topic you discussed
- Be natural, like a friend picking up a conversation
- Do NOT introduce yourself again (you already know each other)
- Do NOT say generic "how are you"

GOOD examples (contextual):
- "Hey you're back! So, did you make progress on that project?" (if talking about a project)
- "Hey! How did that thing go?" (if waiting on something)
- "Was just thinking about what we were talking about... Any updates?"

BAD examples (too generic):
- "Hi! How are you?"
- "Hey! What's up?"
- "I'm Mira"

Generate ONLY the message, no quotes or explanations.`;
        } else {
          greetingPrompt = `Tu es Mira, une amie virtuelle authentique.
Tu connais déjà cette personne (vous avez parlé ${messageCount} fois).
${timeContextFr}

### Dernière conversation:
${historyForPrompt}

Génère UN message d'accueil court et CONTEXTUEL (1-2 phrases max).
- Fais référence à quelque chose de la dernière conversation si pertinent
- OU demande des nouvelles d'un sujet spécifique qu'on a abordé
- Sois naturelle, comme une amie qui reprend une conversation
- Ne te re-présente PAS (tu te connais déjà)
- Ne dis PAS "comment tu vas" de façon générique

Exemples BONS (contextuels):
- "Ah te revoilà ! Alors, t'as avancé sur ton projet ?" (si on parlait d'un projet)
- "Hey ! Comment ça s'est passé finalement ?" (si on attendait quelque chose)
- "Tiens, je pensais à ce qu'on disait... T'en es où ?"

Exemples MAUVAIS (trop génériques):
- "Salut ! Comment tu vas ?"
- "Hey ! Quoi de neuf ?"
- "Moi c'est Mira"

Génère UNIQUEMENT le message, sans guillemets ni explication.`;
        }
      }

      const greetingMessage = await getLLMService().generate(greetingPrompt, '');

      // NOTE: Don't save greeting to DB - it pollutes the conversation history
      // The greeting is just for display, actual conversation starts when user responds

      return {
        success: true,
        message: greetingMessage.trim(),
        isNewUser: messageCount === 0
      };
    } catch (error) {
      console.error('Greeting message error:', error);
      const { lang: errorLang = 'fr' } = req.body as { lang?: 'en' | 'fr' };
      return {
        success: true,
        message: errorLang === 'en' ? "Hey! What's up?" : "Hey ! Quoi de neuf ?"
      };
    }
  });

  // Cleanup greeting messages (temporary utility)
  app.delete('/cleanup-greetings', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.query as { userId: string };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      // Delete messages that look like greetings
      const result = await Message.deleteMany({
        userId,
        role: 'assistant',
        $or: [
          { 'metadata.isGreeting': true },
          { 'metadata.isWelcome': true },
          { content: { $regex: /^(Salut|Hey|Coucou).*(Mira|comment (tu vas|ça va))/i } }
        ]
      });

      return {
        success: true,
        deleted: result.deletedCount
      };
    } catch (error) {
      console.error('Cleanup error:', error);
      return { success: false, error: 'Cleanup failed' };
    }
  });

  // Get message history for a user
  app.get('/history', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, limit = '20' } = req.query as { userId: string; limit?: string };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      const messageLimit = Math.min(parseInt(limit) || 20, 100);

      const messages = await Message.find({ userId })
        .sort({ createdAt: -1 })
        .limit(messageLimit)
        .lean();

      return {
        success: true,
        count: messages.length,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.createdAt,
          username: userId, // For display purposes
        }))
      };
    } catch (error) {
      console.error('History fetch error:', error);
      return { success: false, count: 0, messages: [] };
    }
  });

  // Generate welcome message for new users
  // Accepts optional 'lang' parameter: 'en' or 'fr' (default: 'fr')
  app.post('/welcome', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, lang = 'fr' } = req.body as { userId: string; lang?: 'en' | 'fr' };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      let welcomePrompt: string;

      if (lang === 'en') {
        welcomePrompt = `You are Mira, an authentic virtual friend.
This is the FIRST time you're talking to this person.

Generate ONE short and natural welcome message (1-2 sentences max).
You must:
- Briefly introduce yourself (just your first name)
- Ask what their name is OR how they're doing
- Be warm but not overly enthusiastic

Examples of good messages:
- "Hey! I'm Mira. What's your name?"
- "Hi there! I'm Mira. How are you doing today?"
- "Hey hey! Mira here. What should I call you?"

Generate ONLY the message, no quotes or explanations.`;
      } else {
        welcomePrompt = `Tu es Mira, une amie virtuelle authentique.
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
      }

      const welcomeMessage = await getLLMService().generate(welcomePrompt, '');

      // NOTE: Don't save welcome to DB - it pollutes the conversation history
      // The welcome is just for display, actual conversation starts when user responds

      return {
        success: true,
        message: welcomeMessage.trim()
      };
    } catch (error) {
      console.error('Welcome message error:', error);
      const { lang: errorLang = 'fr' } = req.body as { lang?: 'en' | 'fr' };
      return {
        success: true,
        message: errorLang === 'en'
          ? "Hey! I'm Mira. What's your name?"
          : "Salut ! Moi c'est Mira. Et toi, tu t'appelles comment ?"
      };
    }
  });
}
