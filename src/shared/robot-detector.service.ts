/**
 * RobotDetector - Detects robotic/unnatural responses BEFORE sending to user
 * This is the FINAL layer before a response is sent.
 *
 * If a response is detected as robotic, it will be regenerated.
 */

export interface RobotScore {
  isRobotic: boolean;
  roboticityScore: number; // 0-100 (0=human, 100=robot)
  issues: string[];
  suggestions: string[];
  passed: boolean; // true if score < 30 (acceptable)
}

export interface PreviousResponse {
  content: string;
  timestamp?: Date;
}

export class RobotDetectorService {
  // Common expressions that Mira should vary (not repeat too often)
  private readonly TRACKED_EXPRESSIONS = [
    // French interjections
    'ah ouais',
    'ah ok',
    'ah bon',
    'ah oui',
    'ah d\'accord',
    'oh cool',
    'oh sympa',
    'trop bien',
    'génial',
    'super',
    'nickel',
    'parfait',
    'excellent',
    'c\'est clair',
    'carrément',
    'grave',
    'tellement',
    'je vois',
    'je comprends',
    'd\'accord',
    'ok ok',
    'intéressant',
    'pas mal',
    'stylé',
    'ouf',
    'waw',
    'wow',
    // Common starters
    'haha',
    'hihi',
    'mdrrr',
    'ptdr',
    'hm',
    'hmm',
    'bah',
    'ben',
    'bon',
    'bref',
    'enfin',
    'du coup',
    'en fait',
    'genre',
    'attends',
    'écoute',
    // English equivalents
    'oh really',
    'oh nice',
    'that\'s cool',
    'interesting',
    'i see',
    'got it',
    'makes sense',
    'for sure',
    'totally',
  ];

  /**
   * Main function: Check if a response sounds robotic
   */
  detectRobotVoice(
    response: string,
    userMessage: string,
    previousResponses: PreviousResponse[] = []
  ): RobotScore {
    const issues: string[] = [];
    let roboticityScore = 0;

    // Check 1: Generic phrases (FR + EN)
    const genericPhrases = this.checkGenericPhrases(response);
    if (genericPhrases.found) {
      issues.push(`Phrases génériques: ${genericPhrases.phrases.join(', ')}`);
      roboticityScore += genericPhrases.severity;
    }

    // Check 2: Corporate/Assistant phrases
    const corporatePhrase = this.checkCorporatePhrases(response);
    if (corporatePhrase.found) {
      issues.push(`Phrases corporate: ${corporatePhrase.phrases.join(', ')}`);
      roboticityScore += 20;
    }

    // Check 3: Over-validation
    const overValidation = this.checkOverValidation(response);
    if (overValidation.found) {
      issues.push(`Sur-validation: "${overValidation.phrases.join('", "')}"`);
      roboticityScore += 15;
    }

    // Check 4: Over-formality
    const formality = this.checkFormality(response);
    if (formality.isTooFormal) {
      issues.push(`Trop formel: ${formality.examples.join(', ')}`);
      roboticityScore += 12;
    }

    // Check 5: Lack of natural conversation markers
    const conversationMarkers = this.checkConversationMarkers(response);
    if (!conversationMarkers.hasMarkers) {
      issues.push('Manque de marqueurs conversationnels naturels');
      roboticityScore += 8;
    }

    // Check 6: Question frequency (too many or too few)
    const questions = this.checkQuestionFrequency(response);
    if (!questions.isBalanced) {
      issues.push(questions.message);
      roboticityScore += questions.penalty;
    }

    // Check 7: Repetitive structure
    const repetition = this.checkRepetitiveStructure(response);
    if (repetition.isRepetitive) {
      issues.push('Structure de phrases répétitive');
      roboticityScore += 10;
    }

    // Check 8: Response too long
    if (response.length > 400) {
      issues.push('Réponse trop longue (doit être 1-3 phrases courtes)');
      roboticityScore += 8;
    }

    // Check 9: Starts with same words as user (parroting)
    const parroting = this.checkParroting(response, userMessage);
    if (parroting.isParroting) {
      issues.push('Répétition du message utilisateur (parroting)');
      roboticityScore += 12;
    }

    // Check 10: Expression repetition from previous responses
    const expressionRepetition = this.checkExpressionRepetition(response, previousResponses);
    if (expressionRepetition.found) {
      issues.push(`Expressions répétées: ${expressionRepetition.expressions.join(', ')}`);
      roboticityScore += expressionRepetition.severity;
    }

    // Normalize score
    roboticityScore = Math.min(100, roboticityScore);

    const passed = roboticityScore < 30; // Less than 30 is acceptable

    return {
      isRobotic: !passed,
      roboticityScore,
      issues,
      suggestions: this.generateSuggestions(issues),
      passed,
    };
  }

  /**
   * Check 10: Expression repetition from recent Mira responses
   * Detects when Mira uses the same expressions too often
   */
  private checkExpressionRepetition(
    response: string,
    previousResponses: PreviousResponse[]
  ): { found: boolean; expressions: string[]; severity: number } {
    if (previousResponses.length === 0) {
      return { found: false, expressions: [], severity: 0 };
    }

    const responseLower = response.toLowerCase();
    const repeatedExpressions: string[] = [];

    // Get expressions used in current response
    const currentExpressions = this.TRACKED_EXPRESSIONS.filter((expr) =>
      responseLower.includes(expr.toLowerCase())
    );

    // Check if these expressions were used in recent responses
    // Weight recent messages more heavily (last 3-5 messages)
    const recentResponses = previousResponses.slice(-5);

    for (const expr of currentExpressions) {
      const exprLower = expr.toLowerCase();
      let recentUsageCount = 0;

      for (let i = 0; i < recentResponses.length; i++) {
        const prevContent = recentResponses[i].content.toLowerCase();
        if (prevContent.includes(exprLower)) {
          // Weight more recent messages more heavily
          const recencyWeight = (i + 1) / recentResponses.length;
          recentUsageCount += recencyWeight;
        }
      }

      // If expression was used recently (weighted count > 0.5), flag it
      if (recentUsageCount > 0.5) {
        repeatedExpressions.push(expr);
      }
    }

    // Calculate severity based on number of repeated expressions
    const severity = repeatedExpressions.length * 12; // 12 points per repeated expression

    return {
      found: repeatedExpressions.length > 0,
      expressions: repeatedExpressions,
      severity,
    };
  }

  /**
   * Get alternative expressions to suggest
   */
  getAlternativeExpressions(usedExpression: string): string[] {
    const alternatives: Record<string, string[]> = {
      'ah ouais': ['je vois', 'ah ok', 'intéressant', 'hm', 'd\'accord'],
      'ah ok': ['je vois', 'ah d\'accord', 'ok ok', 'compris'],
      'ah bon': ['ah oui ?', 'vraiment ?', 'sérieux ?', 'c\'est vrai ?'],
      'trop bien': ['génial', 'super', 'nickel', 'cool', 'stylé'],
      'génial': ['super', 'trop bien', 'parfait', 'nickel', 'cool'],
      'super': ['génial', 'trop bien', 'cool', 'nickel', 'top'],
      'c\'est clair': ['carrément', 'grave', 'tellement', 'clairement'],
      'carrément': ['grave', 'tellement', 'c\'est clair', 'complètement'],
      'je vois': ['ah ok', 'd\'accord', 'je comprends', 'ok'],
      'intéressant': ['pas mal', 'cool', 'ah ouais', 'stylé'],
      'haha': ['hihi', '😄', 'mdrrr', ''],
      'du coup': ['donc', 'et', 'alors', 'bref'],
      'en fait': ['genre', 'bon', 'bah', ''],
    };

    const key = usedExpression.toLowerCase();
    return alternatives[key] || [];
  }

  /**
   * Check 1: Generic phrases that sound robotic (FR + EN)
   */
  private checkGenericPhrases(response: string): {
    found: boolean;
    phrases: string[];
    severity: number;
  } {
    const genericPhrases = [
      // French
      "c'est bien ça",
      'de quoi aimerais-tu',
      'de quoi voudrais-tu',
      'de quoi souhaitez-vous',
      "d'accord, je comprends",
      'je comprends ce que tu ressens',
      "n'hésite pas à",
      "c'est une bonne question",
      "c'est une excellente question",
      'en quoi puis-je',
      'que puis-je faire pour',
      'je suis là pour toi',
      'comment puis-je t\'aider',
      "c'est tout à fait normal",
      'je suis ravie de',
      'avec plaisir',
      'bien sûr, je peux',
      "en résumé",
      "pour résumer",
      "en conclusion",
      // English
      "that's great",
      'sounds good',
      'makes sense',
      'i appreciate',
      'thank you for sharing',
      'i understand',
      'thanks for letting me know',
      'let me know',
      'feel free to',
      "don't hesitate",
      'in any case',
      'in summary',
      'to sum up',
      'all the best',
      'hope this helps',
      'just let me know',
    ];

    const responseLower = response.toLowerCase();
    const found = genericPhrases.filter((phrase) =>
      responseLower.includes(phrase)
    );

    return {
      found: found.length > 0,
      phrases: found,
      severity: found.length * 8, // 8 points per generic phrase
    };
  }

  /**
   * Check 2: Corporate/Assistant phrases
   */
  private checkCorporatePhrases(response: string): {
    found: boolean;
    phrases: string[];
  } {
    const corporatePhrases = [
      // French
      'en tant qu\'ia',
      'en tant qu\'assistant',
      'je ne peux pas',
      'je suis incapable de',
      'je m\'excuse',
      'malheureusement',
      'je suis dans l\'impossibilité',
      'veuillez noter',
      'pour votre information',
      'soyez assuré',
      'permettez-moi de',
      'je me permets de',
      // English
      'as an ai',
      'as an assistant',
      'i cannot',
      'i am unable to',
      'i apologize',
      'unfortunately',
      "i'm unable",
      'just wanted to mention',
      'just wanted to say',
      'as a reminder',
      'to assist you',
      'rest assured',
      'please note',
      'for your information',
    ];

    const responseLower = response.toLowerCase();
    const found = corporatePhrases.filter((phrase) =>
      responseLower.includes(phrase)
    );

    return {
      found: found.length > 0,
      phrases: found,
    };
  }

  /**
   * Check 3: Over-validation
   */
  private checkOverValidation(response: string): {
    found: boolean;
    phrases: string[];
  } {
    const overValidationPhrases = [
      // French
      'je comprends totalement',
      'je comprends parfaitement',
      'absolument',
      "c'est valide",
      "c'est légitime",
      'ça fait sens',
      'je t\'entends',
      'tu as raison',
      'tu as tout à fait raison',
      'je suis d\'accord avec toi',
      'effectivement',
      // English
      'i totally understand',
      'i completely understand',
      'absolutely',
      "that's valid",
      "that's fair",
      'that makes sense',
      'i hear you',
      "you're right",
    ];

    const responseLower = response.toLowerCase();
    const matches = overValidationPhrases.filter((phrase) =>
      responseLower.includes(phrase)
    );

    // If more than 1 validation phrase, it's over-validation
    const isOverValidated = matches.length > 1;

    return {
      found: isOverValidated,
      phrases: matches,
    };
  }

  /**
   * Check 4: Over-formality
   */
  private checkFormality(response: string): {
    isTooFormal: boolean;
    examples: string[];
  } {
    const formalPhrases = [
      // French
      'par conséquent',
      'en outre',
      'ci-après',
      'susmentionné',
      'conformément à',
      'en ce qui concerne',
      'dans l\'éventualité où',
      'nonobstant',
      'il est recommandé que',
      'il convient de',
      'il est à noter que',
      'nous vous prions de',
      // English
      'furthermore',
      'moreover',
      'herein',
      'aforementioned',
      'pursuant to',
      'with regards to',
      'in the event that',
      'notwithstanding',
      'it is recommended that',
      'one might consider',
    ];

    const responseLower = response.toLowerCase();
    const found = formalPhrases.filter((phrase) =>
      responseLower.includes(phrase)
    );

    return {
      isTooFormal: found.length > 0,
      examples: found,
    };
  }

  /**
   * Check 5: Conversation markers (shows natural speech)
   */
  private checkConversationMarkers(response: string): {
    hasMarkers: boolean;
    markers: string[];
  } {
    const markers = [
      // French
      'hmm',
      'ah',
      'oh',
      'genre',
      'bah',
      'enfin',
      'quoi',
      'hein',
      'mdr',
      'ptdr',
      'lol',
      'trop',
      'grave',
      'carrément',
      'franchement',
      'honnêtement',
      'en fait',
      'du coup',
      'bon',
      'bref',
      'attends',
      'écoute',
      'tu vois',
      't\'sais',
      'jsp',
      'sérieux',
      'ouais',
      'nan',
      // English
      'interesting',
      'curious',
      'honestly',
      'actually',
      'i think',
      "i'd say",
      'seems like',
      'feels like',
      'kind of',
      'sort of',
      'right',
      'yeah',
      'that said',
      'though',
      "i've noticed",
    ];

    const responseLower = response.toLowerCase();
    const found = markers.filter((marker) => responseLower.includes(marker));

    return {
      hasMarkers: found.length > 0,
      markers: found,
    };
  }

  /**
   * Check 6: Question frequency
   */
  private checkQuestionFrequency(response: string): {
    isBalanced: boolean;
    message: string;
    penalty: number;
  } {
    const questionCount = (response.match(/\?/g) || []).length;
    const sentences = response.split(/[.!?]/).filter((s) => s.trim().length > 0);
    const totalSentences = Math.max(sentences.length, 1);
    const questionRatio = questionCount / totalSentences;

    // More than 2 questions is too many for a casual conversation
    if (questionCount > 2) {
      return {
        isBalanced: false,
        message: `Trop de questions (${questionCount}) - sonne comme un interrogatoire`,
        penalty: 12,
      };
    }

    if (questionCount === 0 && totalSentences > 1) {
      return {
        isBalanced: false,
        message: 'Aucune question posée - monologue plutôt que conversation',
        penalty: 8,
      };
    }

    return {
      isBalanced: true,
      message: 'Fréquence de questions équilibrée',
      penalty: 0,
    };
  }

  /**
   * Check 7: Repetitive structure
   */
  private checkRepetitiveStructure(response: string): {
    isRepetitive: boolean;
  } {
    const sentences = response.split(/[.!?]+/).filter((s) => s.trim());

    if (sentences.length < 2) return { isRepetitive: false };

    // Check if many sentences start the same way
    const startWords = sentences.map((s) =>
      s.trim().split(' ')[0]?.toLowerCase() || ''
    );
    const startWordCounts: Record<string, number> = {};

    startWords.forEach((word) => {
      if (word) {
        startWordCounts[word] = (startWordCounts[word] || 0) + 1;
      }
    });

    const maxCount = Math.max(...Object.values(startWordCounts), 0);
    const isRepetitive = maxCount > sentences.length * 0.5;

    return { isRepetitive };
  }

  /**
   * Check 8: Parroting user's message
   */
  private checkParroting(response: string, userMessage: string): {
    isParroting: boolean;
  } {
    const userWords = userMessage.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const responseWords = response.toLowerCase().split(/\s+/).filter((w) => w.length > 4);

    if (userWords.length === 0 || responseWords.length === 0) {
      return { isParroting: false };
    }

    // Check first 5 words of response
    const first5ResponseWords = responseWords.slice(0, 5);
    let matchCount = 0;

    for (const word of first5ResponseWords) {
      if (userWords.includes(word)) {
        matchCount++;
      }
    }

    // If more than 60% of first words match user message, it's parroting
    const isParroting = matchCount / Math.min(5, first5ResponseWords.length) > 0.6;

    return { isParroting };
  }

  /**
   * Generate actionable suggestions
   */
  private generateSuggestions(issues: string[]): string[] {
    const suggestions: string[] = [];

    if (issues.some((i) => i.includes('génériques') || i.includes('Generic'))) {
      suggestions.push('Remplacer les phrases génériques par des réactions spécifiques');
    }

    if (issues.some((i) => i.includes('corporate') || i.includes('Corporate'))) {
      suggestions.push('Utiliser un langage plus décontracté, comme avec un ami');
    }

    if (issues.some((i) => i.includes('formel') || i.includes('formal'))) {
      suggestions.push('Parler de façon plus casual, moins soutenue');
    }

    if (issues.some((i) => i.includes('marqueurs') || i.includes('markers'))) {
      suggestions.push('Ajouter des marqueurs naturels: "Ah", "Genre", "En fait"');
    }

    if (issues.some((i) => i.includes('question'))) {
      suggestions.push('Équilibrer les affirmations et les questions');
    }

    if (issues.some((i) => i.includes('répétitive') || i.includes('repetitive'))) {
      suggestions.push('Varier la structure des phrases');
    }

    if (issues.some((i) => i.includes('validation') || i.includes('validation'))) {
      suggestions.push('Éviter de trop valider - réagir naturellement');
    }

    if (issues.some((i) => i.includes('parroting'))) {
      suggestions.push('Ne pas répéter ce que l\'utilisateur vient de dire');
    }

    if (issues.some((i) => i.includes('répétées') || i.includes('Expressions'))) {
      suggestions.push('Varier les expressions - utiliser des alternatives comme "je vois", "hm", "ok"');
    }

    return suggestions;
  }
}

export const robotDetector = new RobotDetectorService();
