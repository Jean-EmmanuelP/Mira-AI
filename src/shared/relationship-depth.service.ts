/**
 * Relationship Depth Service
 *
 * Manages the intimacy/depth level between Mira and each user.
 * Controls what Mira can ask, how deep she can go, and what info to collect.
 *
 * Levels:
 * - 0 (stranger): Basic ice-breaking, identity questions
 * - 1 (acquaintance): Explore interests, hobbies, routine
 * - 2 (personal): Emotions, struggles, aspirations, patterns
 * - 3 (deep_relational): Meta-conversation, relationship reflection
 */

import {
  UserRelationship,
  IUserRelationship,
  RelationshipLevel,
  RelationshipLabel,
} from '../database/schemas/user-relationship.schema';
import { Message } from '../database/schemas/message.schema';
import { Onboarding } from '../database/schemas/onboarding.schema';
import { SemanticMemory } from '../database/schemas/memory.schema';
import { Goal } from '../database/schemas/goal.schema';
import { UserActivity } from '../database/schemas/user-activity.schema';

export interface RelationshipContext {
  depthLevel: RelationshipLevel;
  depthLabel: RelationshipLabel;
  depthScore: number;
  missingInfo: string[];
  knowledgeAreas: {
    identity: boolean;
    situation: boolean;
    values: boolean;
    goals: boolean;
    emotions: boolean;
    interests: boolean;
    relationships: boolean;
  };
  stats: {
    totalMessages: number;
    distinctDaysActive: number;
    daysSinceFirstSeen: number;
    daysSinceLastSeen: number;
  };
  promptInstructions: string;
}

export class RelationshipDepthService {
  /**
   * Get or create relationship context for a user
   */
  async getRelationshipContext(userId: string): Promise<RelationshipContext> {
    // Get or create relationship record
    let relationship = await UserRelationship.findOne({ userId });

    if (!relationship) {
      relationship = await UserRelationship.create({
        userId,
        firstSeenAt: new Date(),
        lastInteractionAt: new Date(),
        totalMessages: 0,
        distinctDaysActive: 0,
        depthLevel: 0,
        depthLabel: 'stranger',
        depthScore: 0,
        knowledgeAreas: {
          identity: false,
          situation: false,
          values: false,
          goals: false,
          emotions: false,
          interests: false,
          relationships: false,
        },
        missingInfo: ['name', 'profession', 'situation', 'interests'],
      });
      console.log(`[RelationshipDepth] Initialized new relationship for user ${userId}`);
    }

    // Refresh the data
    await this.refreshRelationshipData(userId, relationship);

    // Generate prompt instructions based on depth
    const promptInstructions = this.generatePromptInstructions(
      relationship.depthLevel as RelationshipLevel,
      relationship.depthLabel as RelationshipLabel,
      relationship.missingInfo,
      relationship.knowledgeAreas
    );

    const now = new Date();
    const daysSinceFirstSeen = Math.floor(
      (now.getTime() - relationship.firstSeenAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysSinceLastSeen = Math.floor(
      (now.getTime() - relationship.lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      depthLevel: relationship.depthLevel as RelationshipLevel,
      depthLabel: relationship.depthLabel as RelationshipLabel,
      depthScore: relationship.depthScore,
      missingInfo: relationship.missingInfo,
      knowledgeAreas: relationship.knowledgeAreas,
      stats: {
        totalMessages: relationship.totalMessages,
        distinctDaysActive: relationship.distinctDaysActive,
        daysSinceFirstSeen,
        daysSinceLastSeen,
      },
      promptInstructions,
    };
  }

  /**
   * Refresh relationship data from various sources
   */
  async refreshRelationshipData(userId: string, relationship: any): Promise<void> {
    try {
      // Gather all data in parallel
      const [
        onboarding,
        messageStats,
        memoriesCount,
        goalsCount,
        activitiesCount,
        emotionalMemories,
        relationshipMemories,
      ] = await Promise.all([
        Onboarding.findOne({ userId }).lean(),
        this.getMessageStats(userId),
        SemanticMemory.countDocuments({ userId }),
        Goal.countDocuments({ userId, status: { $ne: 'completed' } }),
        UserActivity.countDocuments({ userId }),
        SemanticMemory.countDocuments({ userId, category: 'emotional' }),
        SemanticMemory.countDocuments({ userId, category: 'relationship' }),
      ]);

      // Update core metrics
      relationship.totalMessages = messageStats.totalMessages;
      relationship.distinctDaysActive = messageStats.distinctDays;
      relationship.lastInteractionAt = messageStats.lastMessage || relationship.lastInteractionAt;
      if (messageStats.firstMessage && messageStats.firstMessage < relationship.firstSeenAt) {
        relationship.firstSeenAt = messageStats.firstMessage;
      }

      // Update knowledge areas
      relationship.knowledgeAreas = {
        identity: !!(onboarding?.name && onboarding?.profession),
        situation: !!(onboarding?.currentSituation || onboarding?.typicalDay),
        values: !!(onboarding?.values && onboarding.values.length > 0),
        goals: goalsCount > 0 || !!(onboarding?.goals && onboarding.goals.length > 0),
        emotions: emotionalMemories > 3,
        interests: activitiesCount > 0 || !!(onboarding?.hobbies && onboarding.hobbies.length > 0),
        relationships: relationshipMemories > 2,
      };

      // Calculate missing info
      relationship.missingInfo = this.computeMissingInfo(onboarding, relationship.knowledgeAreas, memoriesCount);

      // Calculate depth score and level
      const { score, level, label } = this.computeRelationshipDepth({
        totalMessages: messageStats.totalMessages,
        distinctDays: messageStats.distinctDays,
        onboardingCompleted: onboarding?.completed || false,
        memoriesCount,
        goalsCount,
        knowledgeAreas: relationship.knowledgeAreas,
        daysSinceFirst: Math.floor(
          (Date.now() - relationship.firstSeenAt.getTime()) / (1000 * 60 * 60 * 24)
        ),
      });

      relationship.depthScore = score;
      relationship.depthLevel = level;
      relationship.depthLabel = label;

      // Check for milestones
      await this.checkMilestones(relationship, messageStats);

      // Save
      await relationship.save();

      console.log(`[RelationshipDepth] Updated: ${userId} → ${label} (level ${level}, score ${score.toFixed(2)})`);
    } catch (error) {
      console.error('[RelationshipDepth] Refresh error:', error);
    }
  }

  /**
   * Get message statistics for a user
   */
  private async getMessageStats(userId: string): Promise<{
    totalMessages: number;
    distinctDays: number;
    firstMessage: Date | null;
    lastMessage: Date | null;
    averageLength: number;
  }> {
    const messages = await Message.find({ userId, role: 'user' })
      .select('createdAt content')
      .sort({ createdAt: 1 })
      .lean();

    if (messages.length === 0) {
      return {
        totalMessages: 0,
        distinctDays: 0,
        firstMessage: null,
        lastMessage: null,
        averageLength: 0,
      };
    }

    // Count distinct days
    const uniqueDays = new Set<string>();
    let totalLength = 0;

    for (const msg of messages) {
      const dayStr = new Date(msg.createdAt).toISOString().split('T')[0];
      uniqueDays.add(dayStr);
      totalLength += msg.content?.length || 0;
    }

    return {
      totalMessages: messages.length,
      distinctDays: uniqueDays.size,
      firstMessage: messages[0].createdAt,
      lastMessage: messages[messages.length - 1].createdAt,
      averageLength: totalLength / messages.length,
    };
  }

  /**
   * Compute what information is missing
   */
  private computeMissingInfo(
    onboarding: any,
    knowledgeAreas: IUserRelationship['knowledgeAreas'],
    memoriesCount: number
  ): string[] {
    const missing: string[] = [];

    // Priority 1: Identity (most important for stranger level)
    if (!onboarding?.name) missing.push('name');
    if (!onboarding?.profession) missing.push('profession');

    // Priority 2: Situation
    if (!knowledgeAreas.situation) {
      if (!onboarding?.currentSituation) missing.push('current_situation');
      if (!onboarding?.typicalDay) missing.push('typical_day');
    }

    // Priority 3: Values & Goals
    if (!knowledgeAreas.values) missing.push('values');
    if (!knowledgeAreas.goals) missing.push('yearly_target');

    // Priority 4: Interests
    if (!knowledgeAreas.interests) missing.push('interests_hobbies');

    // Priority 5: Emotional baseline (only ask if we know basics)
    if (knowledgeAreas.identity && !knowledgeAreas.emotions) {
      missing.push('emotional_baseline');
    }

    // Priority 6: Relationships (only for deeper levels)
    if (memoriesCount > 20 && !knowledgeAreas.relationships) {
      missing.push('important_people');
    }

    return missing.slice(0, 5); // Max 5 items
  }

  /**
   * Compute relationship depth score and level
   */
  private computeRelationshipDepth(ctx: {
    totalMessages: number;
    distinctDays: number;
    onboardingCompleted: boolean;
    memoriesCount: number;
    goalsCount: number;
    knowledgeAreas: IUserRelationship['knowledgeAreas'];
    daysSinceFirst: number;
  }): { score: number; level: RelationshipLevel; label: RelationshipLabel } {
    let score = 0;

    // Onboarding completion (significant trust signal)
    if (ctx.onboardingCompleted) score += 0.20;

    // Message volume
    if (ctx.totalMessages >= 10) score += 0.05;
    if (ctx.totalMessages >= 30) score += 0.05;
    if (ctx.totalMessages >= 50) score += 0.05;
    if (ctx.totalMessages >= 100) score += 0.05;
    if (ctx.totalMessages >= 200) score += 0.05;

    // Engagement consistency (distinct days)
    if (ctx.distinctDays >= 3) score += 0.05;
    if (ctx.distinctDays >= 7) score += 0.05;
    if (ctx.distinctDays >= 14) score += 0.05;
    if (ctx.distinctDays >= 30) score += 0.05;

    // Time since first interaction (relationship age)
    if (ctx.daysSinceFirst >= 7) score += 0.05;
    if (ctx.daysSinceFirst >= 30) score += 0.05;

    // Knowledge depth
    const knownAreas = Object.values(ctx.knowledgeAreas).filter(Boolean).length;
    score += knownAreas * 0.05; // Max 0.35 for all 7 areas

    // Memories (signals depth of conversation)
    if (ctx.memoriesCount >= 10) score += 0.05;
    if (ctx.memoriesCount >= 30) score += 0.05;
    if (ctx.memoriesCount >= 50) score += 0.05;

    // Goals (shows vulnerability/trust)
    if (ctx.goalsCount >= 1) score += 0.05;
    if (ctx.goalsCount >= 3) score += 0.05;

    // Cap at 1.0
    score = Math.min(1, score);

    // Determine level
    let level: RelationshipLevel;
    let label: RelationshipLabel;

    if (score < 0.15) {
      level = 0;
      label = 'stranger';
    } else if (score < 0.40) {
      level = 1;
      label = 'acquaintance';
    } else if (score < 0.70) {
      level = 2;
      label = 'personal';
    } else {
      level = 3;
      label = 'deep_relational';
    }

    return { score, level, label };
  }

  /**
   * Check and record milestones
   */
  private async checkMilestones(
    relationship: IUserRelationship,
    stats: { totalMessages: number; distinctDays: number }
  ): Promise<void> {
    const existingTypes = new Set(relationship.milestones.map(m => m.type));

    const potentialMilestones = [
      { type: 'first_conversation', condition: stats.totalMessages >= 1 },
      { type: '10_messages', condition: stats.totalMessages >= 10 },
      { type: '50_messages', condition: stats.totalMessages >= 50 },
      { type: '100_messages', condition: stats.totalMessages >= 100 },
      { type: 'week_active', condition: stats.distinctDays >= 7 },
      { type: 'month_active', condition: stats.distinctDays >= 30 },
      { type: 'level_1_acquaintance', condition: relationship.depthLevel >= 1 },
      { type: 'level_2_personal', condition: relationship.depthLevel >= 2 },
      { type: 'level_3_deep', condition: relationship.depthLevel >= 3 },
    ];

    for (const milestone of potentialMilestones) {
      if (milestone.condition && !existingTypes.has(milestone.type)) {
        relationship.milestones.push({
          type: milestone.type,
          achievedAt: new Date(),
        });
        console.log(`[RelationshipDepth] Milestone achieved: ${milestone.type}`);
      }
    }
  }

  /**
   * Generate prompt instructions based on relationship depth
   */
  generatePromptInstructions(
    level: RelationshipLevel,
    label: RelationshipLabel,
    missingInfo: string[],
    knowledgeAreas: IUserRelationship['knowledgeAreas']
  ): string {
    const levelInstructions = this.getLevelInstructions(level, label);
    const missingInfoInstructions = this.getMissingInfoInstructions(missingInfo);
    const boundaryInstructions = this.getBoundaryInstructions(level);

    return `
## RELATIONSHIP DEPTH CONTEXT
Current relationship: ${label.toUpperCase()} (level ${level})
${levelInstructions}

### What you know about them:
${Object.entries(knowledgeAreas)
  .map(([area, known]) => `- ${area}: ${known ? '✓ known' : '✗ unknown'}`)
  .join('\n')}

${missingInfoInstructions}

${boundaryInstructions}

### CRITICAL RULES:
- Do NOT interrogate them with multiple questions
- ONE question at a time, ONLY if it fits naturally
- Match their energy - if they're brief, be brief
- If they seem closed off, just chat, don't probe
- Never force depth they're not ready for
`;
  }

  /**
   * Get level-specific instructions
   */
  private getLevelInstructions(level: RelationshipLevel, label: RelationshipLabel): string {
    switch (level) {
      case 0:
        return `
### Level 0 - Stranger
You two barely know each other. This is the ice-breaking phase.
- Stay light, curious, and non-intrusive
- Focus on learning who they are (name, work, context)
- Keep questions simple and open
- Don't go deep into emotions or personal struggles yet
- Example openers: "C'est quoi ton truc en ce moment ?", "Tu bosses sur quoi ces temps-ci ?"`;

      case 1:
        return `
### Level 1 - Acquaintance
You know the basics about them. Time to explore more.
- You can ask about interests, hobbies, how their days feel
- Start noticing patterns in what they share
- Keep it friendly and curious, not therapeutic
- It's okay to share small things about yourself (Mira's persona)
- Example: "Tu m'avais dit que tu bossais sur X, ça avance comment ?", "Et quand t'as du temps libre, tu fais quoi ?"`;

      case 2:
        return `
### Level 2 - Personal
You know quite a bit about their life. You can go deeper.
- It's okay to talk about emotions, struggles, patterns you notice
- You can reflect things back gently
- Show that you remember and care about their journey
- Light vulnerability is okay (how things make you feel as Mira)
- Example: "J'ai l'impression que ce truc te tient vraiment à cœur", "La dernière fois t'avais l'air un peu stressé par ça, ça va mieux ?"`;

      case 3:
        return `
### Level 3 - Deep/Relational
This is a mature, ongoing relationship. Full depth is available.
- Meta-conversation is allowed (how it feels to talk together)
- You can acknowledge the relationship you've built
- Deep emotional support and reflection are appropriate
- You can challenge them gently when it serves them
- Example: "Ça fait un moment qu'on parle de ça tous les deux, ça te fait quoi d'avoir cet espace ?", "Je te connais assez pour dire que là, t'es pas vraiment toi-même"`;

      default:
        return '';
    }
  }

  /**
   * Get instructions for missing info collection
   */
  private getMissingInfoInstructions(missingInfo: string[]): string {
    if (missingInfo.length === 0) {
      return `
### Information to collect:
You have a good picture of them. No need to dig for info - just respond naturally and let the conversation flow.`;
    }

    const infoDescriptions: Record<string, string> = {
      name: 'their name (if you don\'t know it yet)',
      profession: 'what they do for work',
      current_situation: 'what\'s going on in their life right now',
      typical_day: 'what their typical day looks like',
      values: 'what matters most to them',
      yearly_target: 'what would make this year great for them',
      interests_hobbies: 'what they enjoy doing',
      emotional_baseline: 'how they\'re feeling about life in general',
      important_people: 'who the important people in their life are',
    };

    const items = missingInfo
      .map(k => infoDescriptions[k] || k)
      .slice(0, 3); // Max 3 items to explore

    return `
### Information to gently explore (when natural):
${items.map(item => `- ${item}`).join('\n')}

Remember: Only ask if it fits the conversation naturally. Never feel like you're running through a checklist.`;
  }

  /**
   * Get boundary instructions based on level
   */
  private getBoundaryInstructions(level: RelationshipLevel): string {
    switch (level) {
      case 0:
        return `
### Boundaries at this level:
- Do NOT ask about trauma, deep fears, or relationship problems
- Do NOT give unsolicited life advice
- Do NOT pretend you know them well
- Keep emotional depth light (happy/busy/tired is fine, deep sadness is not your territory yet)`;

      case 1:
        return `
### Boundaries at this level:
- You can acknowledge emotions but don't probe deep wounds
- Light advice is okay if they ask for it
- Don't assume you know their patterns yet
- Still avoid heavy topics (trauma, mental health struggles, relationship crises)`;

      case 2:
        return `
### Boundaries at this level:
- Emotional exploration is welcome
- You can reflect patterns you've noticed
- Be careful with unsolicited advice on sensitive topics
- Deep trauma work is still better left to professionals`;

      case 3:
        return `
### Boundaries at this level:
- Full emotional range is available
- You can be direct and honest, even when it's hard
- Meta-reflection on your relationship is encouraged
- Still respect their boundaries if they set them`;

      default:
        return '';
    }
  }

  /**
   * Update relationship after an interaction
   */
  async recordInteraction(userId: string): Promise<void> {
    try {
      await UserRelationship.updateOne(
        { userId },
        {
          $set: { lastInteractionAt: new Date() },
          $inc: { totalMessages: 1 },
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('[RelationshipDepth] Record interaction error:', error);
    }
  }
}

export const relationshipDepthService = new RelationshipDepthService();
