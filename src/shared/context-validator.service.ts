/**
 * Context Validator Service
 *
 * Validates responses against conversation context, memory, and temporal coherence.
 * Runs MULTIPLE validation passes to ensure quality.
 *
 * Checks:
 * 1. Temporal coherence - Response makes sense given recent messages
 * 2. Memory consistency - Doesn't contradict or ignore known facts
 * 3. Repetition detection - Catches repeated words/phrases across messages
 * 4. Format issues - Removes unwanted quotes, weird formatting
 * 5. Discovery goals - Ensures natural progression in learning about user
 */

export interface ContextIssue {
  type: 'repetition' | 'memory' | 'temporal' | 'format' | 'discovery' | 'coherence';
  description: string;
  severity: 'low' | 'medium' | 'high';
  fix?: string;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ContextIssue[];
  fixedResponse?: string;
  confidence: number; // 0-100
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export interface UserKnowledge {
  name?: string;
  job?: string;
  interests?: string[];
  goals?: string[];
  location?: string;
  recentTopics?: string[];
}

export class ContextValidatorService {
  /**
   * Main validation function - runs multiple passes
   */
  validate(
    response: string,
    recentMessages: ConversationMessage[],
    userKnowledge: UserKnowledge,
    lang: 'en' | 'fr' = 'fr'
  ): ValidationResult {
    const issues: ContextIssue[] = [];
    let fixedResponse = response;

    // Pass 1: Format issues (quotes, weird chars)
    const formatResult = this.checkFormat(fixedResponse);
    if (formatResult.issues.length > 0) {
      issues.push(...formatResult.issues);
      fixedResponse = formatResult.fixed;
    }

    // Pass 2: Repetition detection across messages
    const repetitionResult = this.checkRepetitions(fixedResponse, recentMessages, lang);
    if (repetitionResult.issues.length > 0) {
      issues.push(...repetitionResult.issues);
    }

    // Pass 3: Temporal coherence
    const temporalResult = this.checkTemporalCoherence(fixedResponse, recentMessages, lang);
    if (temporalResult.issues.length > 0) {
      issues.push(...temporalResult.issues);
    }

    // Pass 4: Memory consistency
    const memoryResult = this.checkMemoryConsistency(fixedResponse, recentMessages, userKnowledge, lang);
    if (memoryResult.issues.length > 0) {
      issues.push(...memoryResult.issues);
    }

    // Pass 5: Discovery goals (are we learning about user naturally?)
    const discoveryResult = this.checkDiscoveryProgress(fixedResponse, recentMessages, userKnowledge, lang);
    if (discoveryResult.issues.length > 0) {
      issues.push(...discoveryResult.issues);
    }

    // Calculate confidence
    const highIssues = issues.filter(i => i.severity === 'high').length;
    const mediumIssues = issues.filter(i => i.severity === 'medium').length;
    const confidence = Math.max(0, 100 - (highIssues * 30) - (mediumIssues * 15));

    return {
      isValid: issues.filter(i => i.severity === 'high').length === 0,
      issues,
      fixedResponse: fixedResponse !== response ? fixedResponse : undefined,
      confidence,
    };
  }

  /**
   * Check for format issues (quotes, weird formatting)
   */
  private checkFormat(response: string): { issues: ContextIssue[]; fixed: string } {
    const issues: ContextIssue[] = [];
    let fixed = response;

    // Remove surrounding quotes
    if (/^["'«].*["'»]$/.test(fixed.trim())) {
      issues.push({
        type: 'format',
        description: 'Response wrapped in quotes',
        severity: 'medium',
        fix: 'Remove surrounding quotes',
      });
      fixed = fixed.trim().slice(1, -1);
    }

    // Remove leading quotes
    if (/^["'«]/.test(fixed.trim())) {
      fixed = fixed.trim().replace(/^["'«]+/, '');
    }

    // Remove trailing quotes
    if (/["'»]$/.test(fixed.trim())) {
      fixed = fixed.trim().replace(/["'»]+$/, '');
    }

    // Remove asterisks (action markers)
    if (/\*[^*]+\*/.test(fixed)) {
      issues.push({
        type: 'format',
        description: 'Contains action markers (*text*)',
        severity: 'low',
      });
      fixed = fixed.replace(/\*[^*]+\*/g, '').trim();
    }

    // Remove markdown formatting
    fixed = fixed.replace(/[_*]{1,2}([^_*]+)[_*]{1,2}/g, '$1');

    return { issues, fixed };
  }

  /**
   * Check for word/phrase repetitions across recent messages
   */
  private checkRepetitions(
    response: string,
    recentMessages: ConversationMessage[],
    lang: 'en' | 'fr'
  ): { issues: ContextIssue[] } {
    const issues: ContextIssue[] = [];
    const responseLower = response.toLowerCase();

    // Get Mira's recent messages (last 5)
    const miraMessages = recentMessages
      .filter(m => m.role === 'assistant')
      .slice(-5)
      .map(m => m.content.toLowerCase());

    // Track repeated starters
    const startersFr = ['ah', 'oh', 'euh', 'bah', 'bon', 'alors', 'du coup', 'genre', 'ouais'];
    const startersEn = ['oh', 'ah', 'well', 'so', 'like', 'yeah', 'okay', 'right'];
    const starters = lang === 'en' ? startersEn : startersFr;

    // Find response starter
    const responseWords = responseLower.split(/\s+/);
    const responseStarter = responseWords[0]?.replace(/[^a-zàâäéèêëïîôùûüç]/gi, '');

    // Count how many recent messages start with the same word
    let starterCount = 0;
    for (const msg of miraMessages) {
      const msgStarter = msg.split(/\s+/)[0]?.replace(/[^a-zàâäéèêëïîôùûüç]/gi, '');
      if (msgStarter === responseStarter && starters.includes(responseStarter)) {
        starterCount++;
      }
    }

    if (starterCount >= 2) {
      issues.push({
        type: 'repetition',
        description: lang === 'en'
          ? `Starting with "${responseStarter}" too often (${starterCount + 1}x in last messages)`
          : `Commence par "${responseStarter}" trop souvent (${starterCount + 1}x dans les derniers messages)`,
        severity: 'high',
        fix: lang === 'en' ? 'Start differently' : 'Commence différemment',
      });
    }

    // Check for repeated phrases (3+ words)
    const responseTriGrams = this.getTriGrams(responseLower);
    for (const msg of miraMessages) {
      const msgTriGrams = this.getTriGrams(msg);
      const common = responseTriGrams.filter(t => msgTriGrams.includes(t));
      if (common.length > 0) {
        issues.push({
          type: 'repetition',
          description: lang === 'en'
            ? `Repeating phrase: "${common[0]}"`
            : `Phrase répétée: "${common[0]}"`,
          severity: 'medium',
        });
        break; // Only report first
      }
    }

    return { issues };
  }

  /**
   * Get trigrams (3-word sequences) from text
   */
  private getTriGrams(text: string): string[] {
    const words = text.split(/\s+/).filter(w => w.length > 2);
    const trigrams: string[] = [];
    for (let i = 0; i < words.length - 2; i++) {
      trigrams.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    return trigrams;
  }

  /**
   * Check temporal coherence - does response make sense given what just happened?
   */
  private checkTemporalCoherence(
    response: string,
    recentMessages: ConversationMessage[],
    lang: 'en' | 'fr'
  ): { issues: ContextIssue[] } {
    const issues: ContextIssue[] = [];

    if (recentMessages.length < 2) return { issues };

    const lastUserMsg = recentMessages.filter(m => m.role === 'user').slice(-1)[0];
    const lastMiraMsg = recentMessages.filter(m => m.role === 'assistant').slice(-1)[0];

    if (!lastUserMsg) return { issues };

    const userContent = lastUserMsg.content.toLowerCase();
    const responseLower = response.toLowerCase();

    // User is leaving/saying goodbye
    const goodbyePatternsFr = [
      /je (te |vous )?(laisse|leave|quitte|pars|y vais|dois y aller)/i,
      /à (plus|toute|bientôt|demain)/i,
      /on se (parle|voit|reparle) (après|plus tard|demain)/i,
      /bye|ciao|salut|tchao/i,
    ];
    const goodbyePatternsEn = [
      /i('m| am) (leaving|going|heading out)/i,
      /(gotta go|have to go|need to go)/i,
      /(talk|see you) (later|soon|tomorrow)/i,
      /bye|ciao|later|peace/i,
    ];
    const goodbyes = lang === 'en' ? goodbyePatternsEn : goodbyePatternsFr;

    const userSayingBye = goodbyes.some(p => p.test(userContent));
    if (userSayingBye) {
      // Response should acknowledge goodbye, not ask questions
      const hasQuestion = response.includes('?');
      const acknowledgesFr = /(ok|à plus|à bientôt|à toute|bonne|ciao|salut|tchao|bye)/i.test(responseLower);
      const acknowledgesEn = /(ok|bye|later|see ya|take care|peace)/i.test(responseLower);
      const acknowledges = lang === 'en' ? acknowledgesEn : acknowledgesFr;

      if (!acknowledges) {
        issues.push({
          type: 'temporal',
          description: lang === 'en'
            ? 'User is leaving but response doesn\'t acknowledge it'
            : 'L\'utilisateur part mais la réponse ne le reconnaît pas',
          severity: 'high',
        });
      }
      if (hasQuestion) {
        issues.push({
          type: 'temporal',
          description: lang === 'en'
            ? 'Asking question when user is leaving'
            : 'Pose une question alors que l\'utilisateur part',
          severity: 'medium',
        });
      }
    }

    // User just answered a question - don't ask the same thing
    if (lastMiraMsg && lastMiraMsg.content.includes('?')) {
      // Extract what Mira asked about
      const miraQuestion = lastMiraMsg.content.toLowerCase();

      // Check if response asks similar thing
      if (response.includes('?')) {
        // Check for redundant questions about same topic
        const topicsFr = ['métier', 'travail', 'boulot', 'job', 'passion', 'hobby', 'intérêt'];
        const topicsEn = ['job', 'work', 'passion', 'hobby', 'interest', 'doing'];
        const topics = lang === 'en' ? topicsEn : topicsFr;

        for (const topic of topics) {
          if (miraQuestion.includes(topic) && responseLower.includes(topic)) {
            issues.push({
              type: 'temporal',
              description: lang === 'en'
                ? `Already asked about "${topic}" in previous message`
                : `Déjà demandé sur "${topic}" dans le message précédent`,
              severity: 'medium',
            });
            break;
          }
        }
      }
    }

    // User corrects Mira or gives feedback
    const correctionPatternsFr = [
      /arrête de|stop de|évite de/i,
      /tu (as |l'as )?dit.*fois/i,
      /pourquoi tu (as |l'as )?(dit|mis|fait)/i,
      /c'est (pas|pas ça|faux)/i,
    ];
    const correctionPatternsEn = [
      /stop (saying|doing)|don't (say|do)/i,
      /you (said|did).*times/i,
      /why did you (say|put|do)/i,
      /that's (not|wrong|incorrect)/i,
    ];
    const corrections = lang === 'en' ? correctionPatternsEn : correctionPatternsFr;

    const userCorrects = corrections.some(p => p.test(userContent));
    if (userCorrects) {
      // Response should acknowledge the correction
      const acknowledgesFr = /(ok|d'accord|promis|pardon|désolé|oups|my bad|compris|noté)/i.test(responseLower);
      const acknowledgesEn = /(ok|okay|sorry|my bad|got it|noted|understood|right)/i.test(responseLower);
      const acknowledges = lang === 'en' ? acknowledgesEn : acknowledgesFr;

      if (!acknowledges) {
        issues.push({
          type: 'temporal',
          description: lang === 'en'
            ? 'User gave correction but response doesn\'t acknowledge it'
            : 'L\'utilisateur a corrigé mais la réponse ne le reconnaît pas',
          severity: 'high',
        });
      }
    }

    return { issues };
  }

  /**
   * Check memory consistency - use what we know about user
   */
  private checkMemoryConsistency(
    response: string,
    recentMessages: ConversationMessage[],
    userKnowledge: UserKnowledge,
    lang: 'en' | 'fr'
  ): { issues: ContextIssue[] } {
    const issues: ContextIssue[] = [];
    const responseLower = response.toLowerCase();

    // Check if asking about something we already know
    if (userKnowledge.job) {
      const jobQuestionsFr = [
        /tu (fais|bosses) quoi/i,
        /c'est quoi (ton|ta) (métier|travail|job|boulot)/i,
        /quel est ton (métier|travail)/i,
      ];
      const jobQuestionsEn = [
        /what do you do/i,
        /what('s| is) your (job|work|profession)/i,
      ];
      const jobQuestions = lang === 'en' ? jobQuestionsEn : jobQuestionsFr;

      if (jobQuestions.some(p => p.test(responseLower))) {
        issues.push({
          type: 'memory',
          description: lang === 'en'
            ? `Already know user's job: ${userKnowledge.job}`
            : `On connaît déjà le métier: ${userKnowledge.job}`,
          severity: 'high',
        });
      }
    }

    // Check if response contradicts recent conversation
    // Look for topic mentioned in last 3 user messages
    const recentUserMsgs = recentMessages
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.content.toLowerCase());

    // If user mentioned something, don't ask about it again
    for (const userMsg of recentUserMsgs) {
      // User mentioned their job
      if (/swe|developer|dev|ingénieur|engineer|code|coder/i.test(userMsg)) {
        if (/tu (fais|bosses) quoi|what do you do/i.test(responseLower)) {
          issues.push({
            type: 'memory',
            description: lang === 'en'
              ? 'User just mentioned their job, don\'t ask again'
              : 'L\'utilisateur vient de mentionner son métier, ne demande pas encore',
            severity: 'high',
          });
        }
      }

      // User mentioned they love their job
      if (/kiff|love|adore|passion/i.test(userMsg) && /taff|job|work|travail/i.test(userMsg)) {
        // Mira should remember this positive sentiment
        if (/tu (aimes|kiffes) (ton|ta)|do you like your/i.test(responseLower)) {
          issues.push({
            type: 'memory',
            description: lang === 'en'
              ? 'User already said they love their job'
              : 'L\'utilisateur a déjà dit qu\'il kiffe son taff',
            severity: 'medium',
          });
        }
      }
    }

    return { issues };
  }

  /**
   * Check discovery progress - are we learning about user naturally?
   */
  private checkDiscoveryProgress(
    response: string,
    recentMessages: ConversationMessage[],
    userKnowledge: UserKnowledge,
    lang: 'en' | 'fr'
  ): { issues: ContextIssue[] } {
    const issues: ContextIssue[] = [];

    // Count how many messages in conversation
    const messageCount = recentMessages.length;

    // Early conversation (< 10 messages) - should be discovering
    if (messageCount < 10) {
      // Check if we're learning basic info
      const hasJob = !!userKnowledge.job;
      const hasInterests = (userKnowledge.interests?.length || 0) > 0;

      // If no job known and not asking about it naturally
      if (!hasJob && messageCount > 4) {
        // Check if recent Mira messages tried to discover
        const miraAskedAboutLife = recentMessages
          .filter(m => m.role === 'assistant')
          .slice(-3)
          .some(m => /(métier|travail|job|boulot|tu fais quoi|what do you do)/i.test(m.content));

        if (!miraAskedAboutLife) {
          issues.push({
            type: 'discovery',
            description: lang === 'en'
              ? 'Haven\'t learned about user\'s work yet - consider asking naturally'
              : 'On ne connaît pas encore le travail de l\'utilisateur - penser à demander naturellement',
            severity: 'low',
          });
        }
      }
    }

    // Check if response is too generic when we have context
    if (userKnowledge.job || (userKnowledge.interests?.length || 0) > 0) {
      const genericPatternsFr = [
        /comment (ça va|tu vas)\s*\?/i,
        /quoi de neuf\s*\?/i,
        /ça (va|roule)\s*\?/i,
      ];
      const genericPatternsEn = [
        /how are you\s*\?/i,
        /what'?s up\s*\?/i,
        /how'?s it going\s*\?/i,
      ];
      const generics = lang === 'en' ? genericPatternsEn : genericPatternsFr;

      if (generics.some(p => p.test(response))) {
        issues.push({
          type: 'discovery',
          description: lang === 'en'
            ? 'Using generic question when we have context to be more specific'
            : 'Question générique alors qu\'on a du contexte pour être plus spécifique',
          severity: 'low',
        });
      }
    }

    return { issues };
  }

  /**
   * Build prompt instructions based on issues found
   */
  buildFixPrompt(issues: ContextIssue[], lang: 'en' | 'fr'): string {
    if (issues.length === 0) return '';

    const lines: string[] = [];

    if (lang === 'en') {
      lines.push('⚠️ ISSUES TO FIX:');
      for (const issue of issues) {
        const severity = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
        lines.push(`${severity} [${issue.type}] ${issue.description}`);
        if (issue.fix) {
          lines.push(`   → Fix: ${issue.fix}`);
        }
      }
    } else {
      lines.push('⚠️ PROBLÈMES À CORRIGER:');
      for (const issue of issues) {
        const severity = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
        lines.push(`${severity} [${issue.type}] ${issue.description}`);
        if (issue.fix) {
          lines.push(`   → Correction: ${issue.fix}`);
        }
      }
    }

    return lines.join('\n');
  }
}

export const contextValidator = new ContextValidatorService();
