/**
 * Time Context Service
 * Provides time-aware context for natural conversations
 * Default timezone: Europe/Paris (MVP)
 */

export interface TimeContext {
  hour: number;
  minute: number;
  dayOfWeek: string;
  dayOfWeekFr: string;
  isWeekend: boolean;
  period: 'night' | 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'late_night';
  periodFr: string;
  periodEn: string;
  greeting: string;
  greetingFr: string;
  contextHint: string;
  contextHintFr: string;
  formattedTime: string;
  formattedDate: string;
}

export class TimeService {
  private timezone: string;

  constructor(timezone: string = 'Europe/Paris') {
    this.timezone = timezone;
  }

  /**
   * Get current time context for natural conversation
   */
  getTimeContext(): TimeContext {
    const now = new Date();

    // Get time in Paris timezone
    const parisTime = new Date(now.toLocaleString('en-US', { timeZone: this.timezone }));
    const hour = parisTime.getHours();
    const minute = parisTime.getMinutes();
    const dayIndex = parisTime.getDay();

    const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const daysFr = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

    const dayOfWeek = daysEn[dayIndex];
    const dayOfWeekFr = daysFr[dayIndex];
    const isWeekend = dayIndex === 0 || dayIndex === 6;

    // Determine period of day
    const { period, periodEn, periodFr } = this.getPeriod(hour);

    // Get appropriate greeting
    const { greeting, greetingFr } = this.getGreeting(hour);

    // Get contextual hints for conversation
    const { contextHint, contextHintFr } = this.getContextHint(hour, isWeekend, dayOfWeek, dayOfWeekFr);

    // Format time and date
    const formattedTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const formattedDate = parisTime.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    return {
      hour,
      minute,
      dayOfWeek,
      dayOfWeekFr,
      isWeekend,
      period,
      periodEn,
      periodFr,
      greeting,
      greetingFr,
      contextHint,
      contextHintFr,
      formattedTime,
      formattedDate
    };
  }

  private getPeriod(hour: number): { period: TimeContext['period'], periodEn: string, periodFr: string } {
    if (hour >= 0 && hour < 5) {
      return { period: 'late_night', periodEn: 'late at night', periodFr: 'tard dans la nuit' };
    } else if (hour >= 5 && hour < 8) {
      return { period: 'early_morning', periodEn: 'early morning', periodFr: 'tôt le matin' };
    } else if (hour >= 8 && hour < 12) {
      return { period: 'morning', periodEn: 'morning', periodFr: 'matin' };
    } else if (hour >= 12 && hour < 18) {
      return { period: 'afternoon', periodEn: 'afternoon', periodFr: 'après-midi' };
    } else if (hour >= 18 && hour < 22) {
      return { period: 'evening', periodEn: 'evening', periodFr: 'soirée' };
    } else {
      return { period: 'night', periodEn: 'night', periodFr: 'nuit' };
    }
  }

  private getGreeting(hour: number): { greeting: string, greetingFr: string } {
    if (hour >= 5 && hour < 12) {
      return { greeting: 'Good morning', greetingFr: 'Bonjour' };
    } else if (hour >= 12 && hour < 18) {
      return { greeting: 'Good afternoon', greetingFr: 'Bon après-midi' };
    } else if (hour >= 18 && hour < 22) {
      return { greeting: 'Good evening', greetingFr: 'Bonsoir' };
    } else {
      return { greeting: 'Hey', greetingFr: 'Hey' };
    }
  }

  private getContextHint(hour: number, isWeekend: boolean, dayOfWeek: string, dayOfWeekFr: string): { contextHint: string, contextHintFr: string } {
    // Late night (0-5)
    if (hour >= 0 && hour < 5) {
      return {
        contextHint: `It's very late (${hour}h). User might be having trouble sleeping, working late, or partying.`,
        contextHintFr: `Il est très tard (${hour}h). L'utilisateur a peut-être du mal à dormir, travaille tard, ou fait la fête.`
      };
    }

    // Early morning (5-8)
    if (hour >= 5 && hour < 8) {
      if (isWeekend) {
        return {
          contextHint: `Early ${dayOfWeek} morning (${hour}h). User is up early on the weekend - maybe sports, travel, or couldn't sleep.`,
          contextHintFr: `Tôt ${dayOfWeekFr} matin (${hour}h). L'utilisateur est debout tôt le weekend - peut-être sport, voyage, ou insomnie.`
        };
      }
      return {
        contextHint: `Early ${dayOfWeek} morning (${hour}h). User is starting their day - maybe getting ready for work.`,
        contextHintFr: `Tôt ${dayOfWeekFr} matin (${hour}h). L'utilisateur commence sa journée - peut-être se prépare pour le travail.`
      };
    }

    // Morning (8-12)
    if (hour >= 8 && hour < 12) {
      if (isWeekend) {
        return {
          contextHint: `${dayOfWeek} morning (${hour}h). Weekend vibes - relaxed morning, maybe brunch plans.`,
          contextHintFr: `${dayOfWeekFr} matin (${hour}h). Ambiance weekend - matinée relax, peut-être brunch prévu.`
        };
      }
      return {
        contextHint: `${dayOfWeek} morning (${hour}h). Workday morning - user might be at work or in transit.`,
        contextHintFr: `${dayOfWeekFr} matin (${hour}h). Matinée de travail - l'utilisateur est peut-être au travail ou en route.`
      };
    }

    // Lunch time (12-14)
    if (hour >= 12 && hour < 14) {
      return {
        contextHint: `Lunch time (${hour}h). User might be on lunch break or eating.`,
        contextHintFr: `Heure du déjeuner (${hour}h). L'utilisateur est peut-être en pause déj ou en train de manger.`
      };
    }

    // Afternoon (14-18)
    if (hour >= 14 && hour < 18) {
      if (isWeekend) {
        return {
          contextHint: `${dayOfWeek} afternoon (${hour}h). Free time - maybe activities, shopping, or relaxing.`,
          contextHintFr: `${dayOfWeekFr} après-midi (${hour}h). Temps libre - peut-être activités, shopping, ou détente.`
        };
      }
      return {
        contextHint: `${dayOfWeek} afternoon (${hour}h). Second half of the workday.`,
        contextHintFr: `${dayOfWeekFr} après-midi (${hour}h). Deuxième partie de la journée de travail.`
      };
    }

    // Evening (18-22)
    if (hour >= 18 && hour < 22) {
      if (hour < 20) {
        return {
          contextHint: `Early evening (${hour}h). End of workday, dinner time, or evening activities.`,
          contextHintFr: `Début de soirée (${hour}h). Fin de journée de travail, dîner, ou activités du soir.`
        };
      }
      return {
        contextHint: `Evening (${hour}h). Relaxing time, watching TV, or going out.`,
        contextHintFr: `Soirée (${hour}h). Moment de détente, télé, ou sortie.`
      };
    }

    // Night (22-24)
    return {
      contextHint: `Night time (${hour}h). User might be winding down, watching something, or going to bed soon.`,
      contextHintFr: `Nuit (${hour}h). L'utilisateur se détend peut-être, regarde quelque chose, ou va bientôt dormir.`
    };
  }

  /**
   * Format time context for LLM prompt
   */
  formatForPrompt(lang: 'en' | 'fr' = 'fr'): string {
    const ctx = this.getTimeContext();

    if (lang === 'en') {
      return `
## CURRENT TIME CONTEXT
- Time: ${ctx.formattedTime} (${ctx.periodEn})
- Day: ${ctx.dayOfWeek}${ctx.isWeekend ? ' (weekend)' : ''}
- Context: ${ctx.contextHint}

Use this time context naturally in your response when relevant. For example:
- Morning: "What's on your agenda today?" / "How'd you sleep?"
- Lunch: "Taking a break?" / "What are you having for lunch?"
- Evening: "How was your day?" / "Any plans tonight?"
- Late night: "Can't sleep?" / "Working late?"
- Weekend: Reference the weekend vibes, free time, relaxation
`;
    }

    return `
## CONTEXTE TEMPOREL
- Heure: ${ctx.formattedTime} (${ctx.periodFr})
- Jour: ${ctx.dayOfWeekFr}${ctx.isWeekend ? ' (weekend)' : ''}
- Contexte: ${ctx.contextHintFr}

Utilise ce contexte temporel naturellement dans ta réponse quand c'est pertinent. Par exemple:
- Matin: "Quoi de prévu aujourd'hui ?" / "Bien dormi ?"
- Midi: "Pause déj ?" / "Tu manges quoi ?"
- Soir: "C'était comment ta journée ?" / "Tu fais quoi ce soir ?"
- Tard la nuit: "Tu dors pas ?" / "Tu bosses tard ?"
- Weekend: Mentionne l'ambiance weekend, le temps libre, la détente
`;
  }
}

// Singleton instance
export const timeService = new TimeService();
