/**
 * Human Detector Service
 *
 * Algorithmic detection of robotic/AI-generated text patterns.
 * Inspired by QuillBot paraphrase detection and BERT-style semantic analysis.
 *
 * Uses multiple heuristics:
 * 1. Lexical Diversity Score (Type-Token Ratio)
 * 2. Sentence Structure Analysis (complexity, variety)
 * 3. N-gram Pattern Detection (common AI phrases)
 * 4. Formality Score (too formal = robotic)
 * 5. Perplexity Estimation (predictable = robotic)
 * 6. Emotional Authenticity (genuine emotion markers)
 */

export interface HumanityScore {
  score: number; // 0-100 (100 = very human, 0 = very robotic)
  issues: string[];
  suggestions: string[];
  details: {
    lexicalDiversity: number;
    structureVariety: number;
    formalityScore: number;
    emotionalAuthenticity: number;
    patternScore: number;
  };
}

// Common robotic n-grams (2-4 word sequences typical of AI)
const ROBOTIC_NGRAMS_FR = [
  // Information patterns
  'je n\'ai pas', 'je ne dispose pas', 'cette information',
  'pourrais-tu me', 'peux-tu me', 'me le rappeler',
  'me préciser', 'me confirmer',
  // Helper patterns
  'je suis là pour', 'n\'hésite pas à', 'à ta disposition',
  'je reste disponible', 'pour t\'aider', 'si tu as besoin',
  'je peux t\'aider', 'je vais t\'aider',
  // Acknowledgment patterns
  'je comprends que', 'je note que', 'c\'est une bonne question',
  'excellente question', 'très bonne question', 'intéressant comme',
  // Filler patterns
  'en effet', 'effectivement', 'tout à fait', 'absolument',
  'bien entendu', 'bien sûr que', 'naturellement',
  // Transition patterns
  'cela dit', 'cependant', 'néanmoins', 'toutefois',
  'par ailleurs', 'de plus', 'en outre',
  // Apologetic patterns
  'je suis désolé', 'malheureusement', 'je regrette',
  // Processing patterns
  'laisse-moi', 'permettez-moi', 'je vais vérifier',
];

const ROBOTIC_NGRAMS_EN = [
  // Information patterns
  'i don\'t have', 'i do not have', 'that information',
  'could you please', 'can you please', 'remind me',
  'clarify', 'specify', 'confirm',
  // Helper patterns
  'i\'m here to', 'feel free to', 'at your disposal',
  'i remain available', 'to help you', 'if you need',
  'i can help', 'i will help', 'let me help',
  // Acknowledgment patterns
  'i understand that', 'i note that', 'that\'s a good question',
  'great question', 'excellent question', 'interesting question',
  // Filler patterns
  'indeed', 'certainly', 'absolutely', 'of course',
  'naturally', 'undoubtedly',
  // Transition patterns
  'that said', 'however', 'nevertheless', 'nonetheless',
  'furthermore', 'moreover', 'additionally',
  // Apologetic patterns
  'i\'m sorry', 'unfortunately', 'i regret',
  // Processing patterns
  'let me', 'allow me', 'i will check',
];

// Human casual markers (presence = more human)
const HUMAN_MARKERS_FR = [
  // Interjections
  'haha', 'hihi', 'mdr', 'lol', 'ptdr', 'omg', 'ouf', 'pff', 'bah',
  'euh', 'hein', 'bof', 'ouais', 'nan', 'yep', 'ok', 'oklm',
  // Casual expressions
  'genre', 'style', 'en mode', 'trop', 'grave', 'carrément',
  'franchement', 'sérieux', 'tranquille', 'cool', 'nickel',
  'relou', 'chiant', 'ouf', 'dingue', 'fou', 'chelou',
  // Contractions/informal
  't\'as', 't\'es', 'j\'sais', 'j\'suis', 'c\'est', 'y\'a',
  'p\'têt', 'p\'tit', 'j\'ai', 'qu\'est-ce',
  // Emotion words
  'kiffe', 'adore', 'déteste', 'flippant', 'stressant',
  // Filler sounds
  'mmh', 'hmm', 'ah', 'oh', 'eh',
];

const HUMAN_MARKERS_EN = [
  // Interjections
  'haha', 'lol', 'lmao', 'omg', 'wow', 'whoa', 'ugh', 'meh',
  'huh', 'yeah', 'nope', 'yep', 'ok', 'okay',
  // Casual expressions
  'like', 'literally', 'basically', 'totally', 'super',
  'kinda', 'sorta', 'pretty', 'really', 'honestly',
  'legit', 'lowkey', 'highkey', 'tbh', 'ngl',
  // Contractions
  'i\'m', 'you\'re', 'we\'re', 'they\'re', 'it\'s',
  'i\'ve', 'you\'ve', 'we\'ve', 'can\'t', 'won\'t',
  'gonna', 'wanna', 'gotta', 'dunno', 'lemme',
  // Emotion words
  'love', 'hate', 'scary', 'stressful', 'crazy',
  // Filler sounds
  'mmm', 'hmm', 'ah', 'oh', 'uh', 'um',
];

// Overly formal words (high frequency = robotic)
const FORMAL_WORDS_FR = [
  'effectivement', 'néanmoins', 'toutefois', 'cependant',
  'concernant', 'relatif', 'ainsi', 'donc', 'par conséquent',
  'afin de', 'dans le but de', 'permettre', 'souhaiter',
  'désirer', 'requérir', 'nécessiter', 'mentionner',
  'préciser', 'indiquer', 'spécifier', 'confirmer',
];

const FORMAL_WORDS_EN = [
  'indeed', 'nevertheless', 'nonetheless', 'however',
  'regarding', 'concerning', 'thus', 'therefore', 'consequently',
  'in order to', 'for the purpose of', 'permit', 'wish',
  'desire', 'require', 'necessitate', 'mention',
  'specify', 'indicate', 'clarify', 'confirm',
];

export class HumanDetectorService {
  /**
   * Main analysis function - returns humanity score
   */
  analyzeHumanity(text: string, lang: 'en' | 'fr' = 'fr'): HumanityScore {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // 1. Lexical Diversity (Type-Token Ratio)
    const lexicalDiversity = this.calculateLexicalDiversity(text);
    if (lexicalDiversity < 0.5) {
      issues.push(lang === 'en' ? 'Low vocabulary diversity' : 'Vocabulaire peu varié');
    }

    // 2. Structure Variety
    const structureVariety = this.analyzeStructureVariety(text);
    if (structureVariety < 0.4) {
      issues.push(lang === 'en' ? 'Monotonous sentence structure' : 'Structure de phrases monotone');
    }

    // 3. Formality Score (lower = more casual = more human)
    const formalityScore = this.calculateFormalityScore(text, lang);
    if (formalityScore > 0.6) {
      issues.push(lang === 'en' ? 'Too formal/stiff' : 'Trop formel/rigide');
      suggestions.push(lang === 'en' ? 'Use casual language' : 'Utilise un langage familier');
    }

    // 4. Emotional Authenticity
    const emotionalAuthenticity = this.calculateEmotionalAuthenticity(text, lang);
    if (emotionalAuthenticity < 0.3) {
      issues.push(lang === 'en' ? 'Lacks emotional markers' : 'Manque de marqueurs émotionnels');
      suggestions.push(lang === 'en' ? 'Add interjections (haha, wow)' : 'Ajoute des interjections (haha, genre)');
    }

    // 5. Pattern Score (robotic n-gram detection)
    const patternScore = this.detectRoboticPatterns(text, lang);
    if (patternScore < 0.5) {
      issues.push(lang === 'en' ? 'Contains AI-typical phrases' : 'Contient des phrases typiques d\'IA');
      suggestions.push(lang === 'en' ? 'Rephrase more naturally' : 'Reformule plus naturellement');
    }

    // Calculate final score (weighted average)
    const weights = {
      lexicalDiversity: 0.15,
      structureVariety: 0.15,
      formalityScore: 0.25, // Inverted: lower formality = higher humanity
      emotionalAuthenticity: 0.20,
      patternScore: 0.25,
    };

    const formalityContribution = (1 - formalityScore); // Invert formality

    const score = Math.round(
      (lexicalDiversity * weights.lexicalDiversity +
       structureVariety * weights.structureVariety +
       formalityContribution * weights.formalityScore +
       emotionalAuthenticity * weights.emotionalAuthenticity +
       patternScore * weights.patternScore) * 100
    );

    return {
      score: Math.max(0, Math.min(100, score)),
      issues,
      suggestions,
      details: {
        lexicalDiversity: Math.round(lexicalDiversity * 100),
        structureVariety: Math.round(structureVariety * 100),
        formalityScore: Math.round(formalityScore * 100),
        emotionalAuthenticity: Math.round(emotionalAuthenticity * 100),
        patternScore: Math.round(patternScore * 100),
      },
    };
  }

  /**
   * Quick check if text is likely robotic (threshold-based)
   */
  isLikelyRobotic(text: string, lang: 'en' | 'fr' = 'fr'): boolean {
    const result = this.analyzeHumanity(text, lang);
    return result.score < 50; // Below 50 = likely robotic
  }

  /**
   * Type-Token Ratio: unique words / total words
   * Higher = more diverse vocabulary = more human
   */
  private calculateLexicalDiversity(text: string): number {
    const words = text.toLowerCase()
      .replace(/[^\w\s'àâäéèêëïîôùûüç-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);

    if (words.length === 0) return 0.5;
    if (words.length < 5) return 0.7; // Short texts get benefit of doubt

    const uniqueWords = new Set(words);
    const ttr = uniqueWords.size / words.length;

    // Normalize to 0-1 range (TTR typically 0.4-0.8 for natural text)
    return Math.min(1, ttr * 1.3);
  }

  /**
   * Analyze sentence structure variety
   * Looks at: length variation, punctuation diversity, starting words
   */
  private analyzeStructureVariety(text: string): number {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length < 2) return 0.6; // Single sentence gets benefit of doubt

    // Length variation (standard deviation)
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const lengthVariety = Math.min(1, stdDev / 5); // Normalize

    // Starting word variety
    const starters = sentences.map(s => s.trim().split(/\s+/)[0]?.toLowerCase());
    const uniqueStarters = new Set(starters);
    const starterVariety = uniqueStarters.size / starters.length;

    // Punctuation variety
    const punctuation = text.match(/[.!?,;:…-]/g) || [];
    const uniquePunct = new Set(punctuation);
    const punctVariety = Math.min(1, uniquePunct.size / 3);

    return (lengthVariety * 0.4 + starterVariety * 0.4 + punctVariety * 0.2);
  }

  /**
   * Calculate formality score
   * Higher = more formal = more robotic
   */
  private calculateFormalityScore(text: string, lang: 'en' | 'fr'): number {
    const textLower = text.toLowerCase();
    const words = textLower.split(/\s+/);
    const wordCount = words.length;

    if (wordCount === 0) return 0.5;

    const formalWords = lang === 'en' ? FORMAL_WORDS_EN : FORMAL_WORDS_FR;
    const humanMarkers = lang === 'en' ? HUMAN_MARKERS_EN : HUMAN_MARKERS_FR;

    // Count formal words
    let formalCount = 0;
    for (const formal of formalWords) {
      if (textLower.includes(formal)) {
        formalCount++;
      }
    }

    // Count human markers
    let humanCount = 0;
    for (const marker of humanMarkers) {
      if (textLower.includes(marker)) {
        humanCount++;
      }
    }

    // Formality ratio
    const formalRatio = formalCount / Math.max(1, wordCount / 5);
    const humanRatio = humanCount / Math.max(1, wordCount / 5);

    // Final score: high formal + low human = high formality
    let score = (formalRatio * 0.6) - (humanRatio * 0.4);
    score = Math.max(0, Math.min(1, score + 0.3)); // Normalize to 0-1

    return score;
  }

  /**
   * Calculate emotional authenticity
   * Presence of genuine emotion markers, interjections, etc.
   */
  private calculateEmotionalAuthenticity(text: string, lang: 'en' | 'fr'): number {
    const textLower = text.toLowerCase();
    const humanMarkers = lang === 'en' ? HUMAN_MARKERS_EN : HUMAN_MARKERS_FR;

    let markerCount = 0;
    for (const marker of humanMarkers) {
      if (textLower.includes(marker)) {
        markerCount++;
      }
    }

    // Check for emojis (very human)
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    const emojiCount = (text.match(emojiRegex) || []).length;

    // Check for repeated punctuation (human emphasis)
    const emphasisCount = (text.match(/[!?]{2,}|\.{3,}/g) || []).length;

    // Check for capitalization for emphasis
    const capsEmphasis = (text.match(/\b[A-Z]{2,}\b/g) || []).length;

    // Combine signals
    const wordCount = textLower.split(/\s+/).length;
    const markerRatio = markerCount / Math.max(1, wordCount / 3);
    const emojiBonus = Math.min(0.3, emojiCount * 0.15);
    const emphasisBonus = Math.min(0.2, (emphasisCount + capsEmphasis) * 0.1);

    return Math.min(1, markerRatio + emojiBonus + emphasisBonus);
  }

  /**
   * Detect robotic n-gram patterns
   * Returns score: 1 = no patterns found (human), 0 = many patterns (robotic)
   */
  private detectRoboticPatterns(text: string, lang: 'en' | 'fr'): number {
    const textLower = text.toLowerCase();
    const ngrams = lang === 'en' ? ROBOTIC_NGRAMS_EN : ROBOTIC_NGRAMS_FR;

    let patternCount = 0;
    const foundPatterns: string[] = [];

    for (const pattern of ngrams) {
      if (textLower.includes(pattern)) {
        patternCount++;
        foundPatterns.push(pattern);
      }
    }

    // Severity increases with pattern count
    if (patternCount === 0) return 1;
    if (patternCount === 1) return 0.7;
    if (patternCount === 2) return 0.4;
    if (patternCount >= 3) return 0.1;

    return 0.5;
  }

  /**
   * Get specific robotic patterns found in text
   */
  getFoundPatterns(text: string, lang: 'en' | 'fr'): string[] {
    const textLower = text.toLowerCase();
    const ngrams = lang === 'en' ? ROBOTIC_NGRAMS_EN : ROBOTIC_NGRAMS_FR;
    const found: string[] = [];

    for (const pattern of ngrams) {
      if (textLower.includes(pattern)) {
        found.push(pattern);
      }
    }

    return found;
  }

  /**
   * Suggest humanized alternatives for robotic patterns
   */
  suggestHumanAlternatives(text: string, lang: 'en' | 'fr'): Map<string, string[]> {
    const alternatives = new Map<string, string[]>();
    const patterns = this.getFoundPatterns(text, lang);

    const replacementsFr: Record<string, string[]> = {
      'je n\'ai pas': ['j\'sais pas', 'aucune idée', 'chais pas'],
      'pourrais-tu me': ['tu peux me', 'redis-moi', 'c\'était quoi'],
      'je suis là pour': ['jsuis là', 'je suis là hein', ''],
      'n\'hésite pas à': ['balance', 'dis-moi', 'vas-y'],
      'c\'est une bonne question': ['bonne question', 'hmm', 'ah ouais'],
      'je comprends': ['ouais je vois', 'ah ok', 'je capte'],
      'effectivement': ['ouais', 'carrément', 'grave'],
      'malheureusement': ['dommage', 'ah mince', 'roh'],
    };

    const replacementsEn: Record<string, string[]> = {
      'i don\'t have': ['no idea', 'dunno', 'not sure'],
      'could you please': ['can you', 'tell me again', 'what was it'],
      'i\'m here to': ['i\'m here', 'yeah i\'m around', ''],
      'feel free to': ['just', 'go ahead', 'sure'],
      'that\'s a good question': ['good one', 'hmm', 'oh'],
      'i understand': ['yeah i get it', 'oh ok', 'gotcha'],
      'indeed': ['yeah', 'totally', 'for sure'],
      'unfortunately': ['too bad', 'ugh', 'damn'],
    };

    const replacements = lang === 'en' ? replacementsEn : replacementsFr;

    for (const pattern of patterns) {
      for (const [key, values] of Object.entries(replacements)) {
        if (pattern.includes(key) || key.includes(pattern)) {
          alternatives.set(pattern, values);
          break;
        }
      }
    }

    return alternatives;
  }
}

export const humanDetector = new HumanDetectorService();
