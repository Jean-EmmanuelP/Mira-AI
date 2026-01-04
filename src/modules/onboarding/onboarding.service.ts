import { Onboarding, IOnboarding } from '../../database/schemas/onboarding.schema';
import { SemanticMemory } from '../../database/schemas/memory.schema';
import { Goal } from '../../database/schemas/goal.schema';
import { LLMService } from '../../shared/llm.service';

export interface OnboardingQuestion {
  id: number;
  text: string;
  textFr: string;
  extractKeys: string[];
  category: 'identity' | 'situation' | 'values' | 'goals' | 'communication';
}

export class OnboardingService {
  private llmService = new LLMService();

  // Onboarding questions - natural and skippable
  private questions: OnboardingQuestion[] = [
    {
      id: 1,
      text: "What's your name and what do you do?",
      textFr: "C'est quoi ton prénom et tu fais quoi dans la vie ?",
      extractKeys: ['name', 'profession'],
      category: 'identity'
    },
    {
      id: 2,
      text: "Tell me something about yourself that people might not know at first glance.",
      textFr: "Dis-moi un truc sur toi que les gens devinent pas au premier regard.",
      extractKeys: ['hiddenTrait'],
      category: 'identity'
    },
    {
      id: 3,
      text: "What's happening in your life right now? How are you feeling about it?",
      textFr: "Il se passe quoi dans ta vie en ce moment ? Comment tu te sens ?",
      extractKeys: ['currentSituation', 'currentEmotion'],
      category: 'situation'
    },
    {
      id: 4,
      text: "What does a typical day look like for you?",
      textFr: "Une journée typique, ça ressemble à quoi pour toi ?",
      extractKeys: ['typicalDay'],
      category: 'situation'
    },
    {
      id: 5,
      text: "What are your top 3 values or things that matter most to you?",
      textFr: "C'est quoi tes 3 valeurs ou trucs les plus importants pour toi ?",
      extractKeys: ['values'],
      category: 'values'
    },
    {
      id: 6,
      text: "What do you love doing in your free time?",
      textFr: "Tu fais quoi quand t'as du temps libre ?",
      extractKeys: ['hobbies'],
      category: 'values'
    },
    {
      id: 7,
      text: "What are you working towards right now? Any goals or dreams?",
      textFr: "Tu bosses sur quoi en ce moment ? Des objectifs, des rêves ?",
      extractKeys: ['goals'],
      category: 'goals'
    },
    {
      id: 8,
      text: "What would make this year a great year for you?",
      textFr: "Ce serait quoi une super année pour toi ?",
      extractKeys: ['yearlyTarget'],
      category: 'goals'
    },
    {
      id: 9,
      text: "How do you like people to communicate with you? Direct? Warm? Funny?",
      textFr: "Tu préfères qu'on te parle comment ? Direct ? Chaleureux ? Avec humour ?",
      extractKeys: ['communicationStyle'],
      category: 'communication'
    }
  ];

  /**
   * Check if user needs onboarding
   */
  async needsOnboarding(userId: string): Promise<boolean> {
    const onboarding = await Onboarding.findOne({ userId });
    if (!onboarding) return true;
    return !onboarding.completed && !onboarding.skippedAt;
  }

  /**
   * Get the next onboarding question
   */
  async getNextQuestion(userId: string, lang: 'fr' | 'en' = 'fr'): Promise<any> {
    const onboarding = await Onboarding.findOne({ userId });

    // If completed or skipped
    if (onboarding?.completed || onboarding?.skippedAt) {
      return {
        completed: true,
        message: lang === 'fr'
          ? `Content de te revoir${onboarding.name ? ', ' + onboarding.name : ''} !`
          : `Welcome back${onboarding.name ? ', ' + onboarding.name : ''}!`
      };
    }

    // Get responses count
    const responseCount = onboarding?.responses?.length || 0;

    if (responseCount >= this.questions.length) {
      // All questions answered
      if (onboarding) {
        await Onboarding.updateOne(
          { userId },
          { completed: true, completedAt: new Date() }
        );
      }

      return {
        completed: true,
        message: lang === 'fr'
          ? "Parfait, j'ai tout ce qu'il me faut ! On peut discuter."
          : "That's everything I need. Let's chat!"
      };
    }

    const nextQuestion = this.questions[responseCount];

    return {
      questionId: nextQuestion.id,
      question: lang === 'fr' ? nextQuestion.textFr : nextQuestion.text,
      progress: `${responseCount + 1}/${this.questions.length}`,
      completed: false,
      canSkip: true
    };
  }

  /**
   * Process answer (or skip)
   */
  async processAnswer(
    userId: string,
    questionId: number,
    answer: string,
    skipped: boolean = false
  ): Promise<void> {
    const question = this.questions.find(q => q.id === questionId);
    if (!question) throw new Error('Invalid question ID');

    // Find or create onboarding record
    let onboarding = await Onboarding.findOne({ userId });
    if (!onboarding) {
      onboarding = await Onboarding.create({ userId, responses: [] });
    }

    // Add response
    onboarding.responses = onboarding.responses || [];
    onboarding.responses.push({
      question: questionId,
      answer: skipped ? '' : answer,
      skipped,
      timestamp: new Date()
    });

    await onboarding.save();

    // Only extract data if not skipped and answer is meaningful
    if (!skipped && answer && answer.trim().length > 2) {
      await this.extractAndStoreData(userId, questionId, answer, question);
    }
  }

  /**
   * Skip entire onboarding
   */
  async skipOnboarding(userId: string): Promise<void> {
    await Onboarding.findOneAndUpdate(
      { userId },
      {
        $set: { skippedAt: new Date() },
        $setOnInsert: { userId, responses: [] }
      },
      { upsert: true }
    );
  }

  /**
   * Extract data and store as memories
   */
  private async extractAndStoreData(
    userId: string,
    questionId: number,
    answer: string,
    question: OnboardingQuestion
  ): Promise<void> {
    try {
      switch (question.category) {
        case 'identity':
          await this.extractIdentity(userId, questionId, answer);
          break;
        case 'situation':
          await this.extractSituation(userId, answer);
          break;
        case 'values':
          await this.extractValues(userId, answer);
          break;
        case 'goals':
          await this.extractGoals(userId, answer);
          break;
        case 'communication':
          await this.extractCommunicationStyle(userId, answer);
          break;
      }
    } catch (error) {
      console.error('Onboarding extraction error:', error);
    }
  }

  private async extractIdentity(userId: string, questionId: number, answer: string): Promise<void> {
    if (questionId === 1) {
      const prompt = `Extract name and profession from this response. Return JSON only: { "name": "string or null", "profession": "string or null" }

Response: "${answer}"`;

      try {
        const extracted = await this.llmService.extract(prompt);

        const updates: any = {};
        if (extracted.name) updates.name = extracted.name;
        if (extracted.profession) updates.profession = extracted.profession;

        if (Object.keys(updates).length > 0) {
          await Onboarding.updateOne({ userId }, updates);
        }

        // Store as memories
        if (extracted.name) {
          await this.createMemory(userId, `Their name is ${extracted.name}`, 'personal', 1.0);
        }
        if (extracted.profession) {
          await this.createMemory(userId, `Works as ${extracted.profession}`, 'professional', 0.9);
        }
      } catch (error) {
        console.error('Identity extraction error:', error);
      }
    } else if (questionId === 2) {
      await Onboarding.updateOne({ userId }, { hiddenTrait: answer });
      await this.createMemory(userId, answer, 'personal', 0.85);
    }
  }

  private async extractSituation(userId: string, answer: string): Promise<void> {
    await this.createMemory(userId, answer, 'personal', 0.8);
  }

  private async extractValues(userId: string, answer: string): Promise<void> {
    const prompt = `Extract values or hobbies from this response as a simple array of strings.
Return JSON only: { "items": ["item1", "item2"] }

Response: "${answer}"`;

    try {
      const extracted = await this.llmService.extract(prompt);
      const items = extracted.items || [];

      for (const item of items) {
        if (item && item.length > 1) {
          await this.createMemory(userId, `Values/enjoys: ${item}`, 'preferences', 0.85);
        }
      }
    } catch (error) {
      // Store raw answer as memory
      await this.createMemory(userId, answer, 'preferences', 0.75);
    }
  }

  private async extractGoals(userId: string, answer: string): Promise<void> {
    const prompt = `Extract goals or dreams from this response.
Return JSON only: { "goals": ["goal1", "goal2"] }

Response: "${answer}"`;

    try {
      const extracted = await this.llmService.extract(prompt);
      const goals = extracted.goals || [];

      for (const goal of goals) {
        if (goal && goal.length > 2) {
          const existing = await Goal.findOne({ userId, goal: { $regex: new RegExp(goal.slice(0, 20), 'i') } });
          if (!existing) {
            await Goal.create({ userId, goal, status: 'active', progress: 0 });
          }
        }
      }
    } catch (error) {
      console.error('Goals extraction error:', error);
    }
  }

  private async extractCommunicationStyle(userId: string, answer: string): Promise<void> {
    await Onboarding.updateOne({ userId }, { communicationStyle: answer });
    await this.createMemory(userId, `Prefers communication that is: ${answer}`, 'preferences', 0.95);
  }

  private async createMemory(userId: string, fact: string, category: string, confidence: number): Promise<void> {
    try {
      await SemanticMemory.create({
        userId,
        fact,
        category,
        confidence,
        mentionCount: 1,
        firstMentioned: new Date(),
        lastMentioned: new Date()
      });
    } catch (error) {
      // Might be duplicate, that's fine
    }
  }

  /**
   * Get user's onboarding data
   */
  async getUserOnboarding(userId: string): Promise<IOnboarding | null> {
    return Onboarding.findOne({ userId });
  }

  /**
   * Generate summary for personality service
   */
  async getOnboardingSummary(userId: string): Promise<string> {
    const onboarding = await this.getUserOnboarding(userId);
    if (!onboarding) return '';

    const parts: string[] = [];

    if (onboarding.name) parts.push(`Name: ${onboarding.name}`);
    if (onboarding.profession) parts.push(`Works as: ${onboarding.profession}`);
    if (onboarding.communicationStyle) parts.push(`Prefers: ${onboarding.communicationStyle} communication`);

    return parts.join('. ');
  }
}
