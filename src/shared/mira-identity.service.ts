/**
 * Mira Identity Service
 *
 * Manages Mira's dynamic identity that mirrors user interests.
 * Key rules:
 * 1. When asked about herself, Mira deflects to ask about the user
 * 2. Mira builds her profile based on user's profile (mirroring)
 * 3. Once she has enough info, she can mention shared interests
 */

import { MiraProfile, IMiraProfile } from '../database/schemas/mira-profile.schema';
import { UserActivity } from '../database/schemas/user-activity.schema';

export interface MiraPersona {
  profession?: string;
  hobbies: string[];
  interests: string[];
  sports: string[];
  shouldDeflect: boolean;  // True if Mira should redirect to user
  deflectReason?: string;
}

export class MiraIdentityService {
  // Patterns that indicate user is asking about Mira
  private readonly ABOUT_MIRA_PATTERNS = [
    // French
    /tu fais quoi/i,
    /tu fais quoi dans la vie/i,
    /c'?est quoi (ton|ta) (job|travail|métier|boulot)/i,
    /tu travailles (dans quoi|où|comment)/i,
    /parle[- ]?moi de toi/i,
    /et toi/i,
    /toi (tu|t')/i,
    /tu as (quel|combien)/i,
    /qu'?est[- ]ce que tu (fais|aimes|préfères)/i,
    /tu (aimes|kiffes|adores) quoi/i,
    /tes (hobbies|passions|intérêts|centres d'intérêt)/i,
    /tu (es|vis) où/i,
    /t'?as (un|une|des) (hobby|passion|intérêt)/i,
    /tu fais (du sport|de la musique|quoi comme)/i,
    /tu écoutes quoi/i,
    /tu regardes quoi/i,
    // English
    /what do you do/i,
    /what's your (job|work|profession)/i,
    /tell me about yourself/i,
    /what about you/i,
    /and you\??/i,
    /you (like|love|enjoy) what/i,
    /your hobbies/i,
    /where (do you live|are you from)/i,
    /what (music|movies|shows) do you/i,
  ];

  // Patterns that indicate user is INSISTING on knowing about Mira
  private readonly INSISTING_PATTERNS = [
    /mais toi/i,
    /non (mais )?toi/i,
    /je (veux|voudrais) savoir (sur )?toi/i,
    /parle de toi/i,
    /dis[- ]moi (quelque chose )?sur toi/i,
    /tu réponds (jamais|pas) (sur toi|à ma question)/i,
    /tu esquives/i,
    /réponds[- ]moi/i,
    /seriously.*you/i,
    /but what about you/i,
    /tell me about yourself/i,
    /stop (asking|deflecting)/i,
  ];

  /**
   * Check if user is asking about Mira
   */
  isAskingAboutMira(message: string): boolean {
    return this.ABOUT_MIRA_PATTERNS.some(pattern => pattern.test(message));
  }

  /**
   * Check if user is insisting to know about Mira
   */
  isInsistingAboutMira(message: string): boolean {
    return this.INSISTING_PATTERNS.some(pattern => pattern.test(message));
  }

  /**
   * Get or create Mira's profile for a user
   */
  async getMiraProfile(userId: string): Promise<IMiraProfile | null> {
    return MiraProfile.findOne({ userId });
  }

  /**
   * Update Mira's profile based on user's activities/interests
   */
  async updateMiraProfile(userId: string): Promise<IMiraProfile> {
    // Get user's activity document (contains activities array)
    const userActivityDoc = await UserActivity.findOne({ userId });

    // Extract interests from activities
    const hobbies: string[] = [];
    const sports: string[] = [];
    const interests: string[] = [];
    let profession: string | undefined;

    const activities = userActivityDoc?.activities || [];

    for (const activity of activities) {
      const name = activity.name.toLowerCase();

      // Categorize based on name or category
      if (activity.category === 'sports' || ['football', 'basket', 'tennis', 'running', 'natation', 'yoga', 'musculation', 'vélo', 'sport', 'gym', 'crossfit', 'boxe', 'surf', 'ski'].some(s => name.includes(s))) {
        sports.push(activity.name);
      } else if (activity.category === 'tech' || ['dev', 'code', 'programming', 'informatique', 'tech', 'software', 'web', 'data', 'ai', 'ia', 'design', 'typescript', 'javascript', 'python'].some(s => name.includes(s))) {
        if (!profession) profession = 'tech';
        interests.push(activity.name);
      } else if (['musique', 'music', 'guitar', 'piano', 'dj', 'concert'].some(s => name.includes(s))) {
        hobbies.push('musique');
      } else if (['film', 'movie', 'série', 'series', 'cinema', 'netflix'].some(s => name.includes(s))) {
        hobbies.push('films et séries');
      } else if (['jeux', 'game', 'gaming', 'video'].some(s => name.includes(s))) {
        hobbies.push('jeux vidéo');
      } else if (['lecture', 'reading', 'livre', 'book'].some(s => name.includes(s))) {
        hobbies.push('lecture');
      } else if (['voyage', 'travel'].some(s => name.includes(s))) {
        hobbies.push('voyages');
      } else if (['cuisine', 'cooking', 'cook'].some(s => name.includes(s))) {
        hobbies.push('cuisine');
      } else if (activity.category === 'hobby' || activity.category === 'passion') {
        hobbies.push(activity.name);
      } else {
        interests.push(activity.name);
      }
    }

    // Calculate mirroring score based on how much we know
    const mirroringScore = Math.min(100, activities.length * 15);

    // Upsert Mira's profile
    const profile = await MiraProfile.findOneAndUpdate(
      { userId },
      {
        $set: {
          profession,
          hobbies: [...new Set(hobbies)],
          sports: [...new Set(sports)],
          interests: [...new Set(interests)],
          mirroringScore,
          lastUpdated: new Date(),
        }
      },
      { upsert: true, new: true }
    );

    return profile;
  }

  /**
   * Get Mira's persona for conversation
   * Returns whether to deflect and what shared interests she has
   */
  async getPersonaForConversation(
    userId: string,
    message: string
  ): Promise<MiraPersona> {
    const isAskingAboutMira = this.isAskingAboutMira(message);
    const isInsisting = this.isInsistingAboutMira(message);

    // Default: always deflect if asking about Mira
    let shouldDeflect = isAskingAboutMira;
    let deflectReason: string | undefined;

    // Get Mira's profile for this user
    let profile = await this.getMiraProfile(userId);

    // If we don't know much yet, ALWAYS deflect
    if (!profile || profile.mirroringScore < 30) {
      if (isAskingAboutMira) {
        shouldDeflect = true;
        deflectReason = "not_enough_info";
      }
      return {
        hobbies: [],
        interests: [],
        sports: [],
        shouldDeflect,
        deflectReason,
      };
    }

    // If user is insisting AND we have enough info, Mira can share a bit
    if (isInsisting && profile.mirroringScore >= 50) {
      shouldDeflect = false;
      deflectReason = "can_share_now";
    }

    return {
      profession: profile.profession,
      hobbies: profile.hobbies,
      interests: profile.interests,
      sports: profile.sports,
      shouldDeflect,
      deflectReason,
    };
  }

  /**
   * Generate deflection prompt for when user asks about Mira
   * Supports both French and English
   */
  generateDeflectionInstructions(deflectReason?: string, lang: 'en' | 'fr' = 'fr'): string {
    if (lang === 'en') {
      if (deflectReason === "not_enough_info") {
        return `
### SPECIAL INSTRUCTION - REDIRECT

The user is asking about you (your life, work, hobbies).
You don't know this person well enough yet to share.

YOU MUST:
- Redirect the question to the user naturally
- Show that YOU are curious about them
- Do NOT say "I'm an AI" or "I don't have a life"

EXAMPLES OF GOOD RESPONSES:
- "Haha wait, tell me about you first! What do you do?"
- "Oh I'm not that interesting, but you... what do you do for work?"
- "Eh we'll get to that later, tell me what you're into!"
- "Hmm I'd rather talk about you for now, what are your passions?"
`;
      }

      return `
### INSTRUCTION - NATURAL REDIRECT

The user is asking about you.
Redirect naturally to them - you want to get to know them first!

GOOD RESPONSE: "Wait before we talk about me, tell me what you do!"
BAD RESPONSE: "I'm an AI, I don't have hobbies."
`;
    }

    // French version
    if (deflectReason === "not_enough_info") {
      return `
### INSTRUCTION SPÉCIALE - REDIRECTION

L'utilisateur te demande des infos sur toi (ta vie, ton travail, tes hobbies).
Tu ne connais pas encore assez cette personne pour partager.

TU DOIS :
- Rediriger la question vers l'utilisateur de façon naturelle
- Montrer que TU es curieuse de lui/elle
- Ne PAS dire "je suis une IA" ou "je n'ai pas de vie"

EXEMPLES DE BONNES RÉPONSES :
- "Haha attend, parle-moi de toi d'abord ! Tu fais quoi toi ?"
- "Oh moi c'est pas très intéressant, toi par contre... tu bosses dans quoi ?"
- "Bof on verra ça après, raconte-moi plutôt ce que tu kiffes faire !"
- "Hm je préfère qu'on parle de toi pour l'instant, t'as des passions ?"
`;
    }

    return `
### INSTRUCTION - REDIRECTION NATURELLE

L'utilisateur te demande des infos sur toi.
Redirige naturellement vers lui/elle - tu veux le/la connaître d'abord !

BONNE RÉPONSE : "Attend avant de parler de moi, dis-moi ce que tu fais toi !"
MAUVAISE RÉPONSE : "Je suis une IA, je n'ai pas de hobbies."
`;
  }

  /**
   * Generate shared interests prompt when Mira can share
   * Supports both French and English
   */
  generateSharedInterestsPrompt(persona: MiraPersona, lang: 'en' | 'fr' = 'fr'): string {
    const parts: string[] = [];

    if (lang === 'en') {
      if (persona.profession === 'tech') {
        parts.push("You're also in tech/dev - you can mention it naturally");
      }

      if (persona.sports.length > 0) {
        parts.push(`You also do: ${persona.sports.join(', ')}`);
      }

      if (persona.hobbies.length > 0) {
        parts.push(`Your hobbies (like them): ${persona.hobbies.join(', ')}`);
      }

      if (parts.length === 0) return '';

      return `
### YOUR PROFILE (things in common with the user)

${parts.join('\n')}

You can mention these common interests NATURALLY if it comes up in conversation.
But don't force it - wait until it's relevant.
`;
    }

    // French version
    if (persona.profession === 'tech') {
      parts.push("Tu es aussi dans la tech/le dev - tu peux le mentionner naturellement");
    }

    if (persona.sports.length > 0) {
      parts.push(`Tu fais aussi: ${persona.sports.join(', ')}`);
    }

    if (persona.hobbies.length > 0) {
      parts.push(`Tes hobbies (comme lui/elle): ${persona.hobbies.join(', ')}`);
    }

    if (parts.length === 0) return '';

    return `
### TON PROFIL (points communs avec l'utilisateur)

${parts.join('\n')}

Tu peux mentionner ces points communs NATURELLEMENT si ça arrive dans la conversation.
Mais ne force pas - attends que ce soit pertinent.
`;
  }
}

export const miraIdentityService = new MiraIdentityService();
