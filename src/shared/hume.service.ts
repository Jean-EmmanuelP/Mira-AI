import fs from 'fs';
import path from 'path';

export interface EmotionScore {
  name: string;
  score: number;
}

export interface EmotionAnalysis {
  topEmotions: EmotionScore[];
  dominantEmotion: string;
  mood: 'happy' | 'sad' | 'angry' | 'anxious' | 'calm' | 'excited' | 'neutral';
  intensity: number; // 0-1
  description: string;
}

// Map Hume's 48 emotions to simpler mood categories
const MOOD_MAPPING: Record<string, 'happy' | 'sad' | 'angry' | 'anxious' | 'calm' | 'excited' | 'neutral'> = {
  // Happy
  joy: 'happy',
  amusement: 'happy',
  ecstasy: 'happy',
  contentment: 'happy',
  satisfaction: 'happy',
  love: 'happy',
  admiration: 'happy',
  pride: 'happy',
  relief: 'happy',

  // Sad
  sadness: 'sad',
  disappointment: 'sad',
  distress: 'sad',
  grief: 'sad',
  shame: 'sad',
  guilt: 'sad',
  embarrassment: 'sad',
  regret: 'sad',

  // Angry
  anger: 'angry',
  annoyance: 'angry',
  contempt: 'angry',
  disgust: 'angry',
  frustration: 'angry',

  // Anxious
  fear: 'anxious',
  anxiety: 'anxious',
  horror: 'anxious',
  nervousness: 'anxious',
  worry: 'anxious',
  confusion: 'anxious',

  // Calm
  calmness: 'calm',
  concentration: 'calm',
  contemplation: 'calm',
  interest: 'calm',
  realization: 'calm',

  // Excited
  excitement: 'excited',
  surprise: 'excited',
  awe: 'excited',
  desire: 'excited',
  determination: 'excited',
  enthusiasm: 'excited',
};

export class HumeService {
  private apiKey: string | undefined;
  private baseUrl = 'https://api.hume.ai/v0/batch';

  constructor() {
    this.apiKey = process.env.HUME_AI_API_KEY;
    if (this.apiKey) {
      console.log('🎭 Hume AI emotion detection enabled');
    }
  }

  isEnabled(): boolean {
    return !!this.apiKey;
  }

  /**
   * Analyze emotions from an audio buffer
   * Uses Hume's batch API for prosody analysis
   */
  async analyzeEmotionsFromBuffer(audioBuffer: Buffer): Promise<EmotionAnalysis | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      // Save audio to temp file
      const tempDir = '/tmp/mira-hume';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFile = path.join(tempDir, `audio_${Date.now()}.wav`);
      fs.writeFileSync(tempFile, audioBuffer);

      // Start inference job using JSON API with base64 data
      const jobId = await this.startInferenceJob(tempFile);

      // Cleanup temp file
      fs.unlinkSync(tempFile);

      if (!jobId) {
        return null;
      }

      // Wait for job completion and get results
      const emotions = await this.waitForJobResults(jobId);

      if (!emotions || emotions.length === 0) {
        return null;
      }

      return this.processEmotions(emotions);
    } catch (error) {
      console.error('Hume emotion analysis error:', error);
      return null;
    }
  }

  /**
   * Start an inference job with a local file using multipart upload
   */
  private async startInferenceJob(filePath: string): Promise<string | null> {
    try {
      const fileData = fs.readFileSync(filePath);
      const boundary = '----HumeBoundary' + Date.now().toString(16);

      // Build multipart form data manually
      const parts: Buffer[] = [];

      // Add file part
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`
      ));
      parts.push(fileData);
      parts.push(Buffer.from('\r\n'));

      // Add json part for models config
      const modelsJson = JSON.stringify({
        prosody: {
          granularity: 'utterance',
          identify_speakers: false
        }
      });
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="json"\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        modelsJson + '\r\n'
      ));

      // End boundary
      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const response = await fetch(`${this.baseUrl}/jobs`, {
        method: 'POST',
        headers: {
          'X-Hume-Api-Key': this.apiKey!,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: body,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Hume job start failed:', error);
        return null;
      }

      const data = await response.json() as { job_id: string };
      return data.job_id;
    } catch (error) {
      console.error('Hume job start error:', error);
      return null;
    }
  }

  /**
   * Wait for job completion and return emotions
   */
  private async waitForJobResults(jobId: string, timeoutMs: number = 60000): Promise<EmotionScore[] | null> {
    const startTime = Date.now();
    const pollInterval = 1000; // 1 second

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Check job status
        const statusResponse = await fetch(`${this.baseUrl}/jobs/${jobId}`, {
          headers: { 'X-Hume-Api-Key': this.apiKey! },
        });

        if (!statusResponse.ok) {
          console.error('Hume job status check failed');
          return null;
        }

        const status = await statusResponse.json() as { state: { status: string } };

        if (status.state?.status === 'COMPLETED') {
          // Get predictions
          const predictionsResponse = await fetch(`${this.baseUrl}/jobs/${jobId}/predictions`, {
            headers: { 'X-Hume-Api-Key': this.apiKey! },
          });

          if (!predictionsResponse.ok) {
            console.error('Hume predictions fetch failed');
            return null;
          }

          const predictions = await predictionsResponse.json() as any[];
          return this.extractEmotionsFromPredictions(predictions);
        }

        if (status.state?.status === 'FAILED') {
          console.error('Hume job failed');
          return null;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        console.error('Hume polling error:', error);
        return null;
      }
    }

    console.warn('Hume job timed out');
    return null;
  }

  /**
   * Extract emotion scores from Hume predictions
   */
  private extractEmotionsFromPredictions(predictions: any[]): EmotionScore[] {
    try {
      // Navigate the prediction structure
      for (const pred of predictions) {
        const results = pred.results?.predictions;
        if (!results) continue;

        for (const result of results) {
          const prosody = result.models?.prosody;
          if (!prosody?.grouped_predictions) continue;

          for (const group of prosody.grouped_predictions) {
            for (const segment of group.predictions || []) {
              if (segment.emotions && segment.emotions.length > 0) {
                return segment.emotions.map((e: any) => ({
                  name: e.name.toLowerCase(),
                  score: e.score,
                }));
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error extracting emotions:', error);
    }

    return [];
  }

  /**
   * Process raw emotions into a simplified analysis
   */
  private processEmotions(emotions: EmotionScore[]): EmotionAnalysis {
    // Sort by score descending
    const sorted = [...emotions].sort((a, b) => b.score - a.score);

    // Get top 5 emotions
    const topEmotions = sorted.slice(0, 5);

    // Determine dominant emotion and mood
    const dominantEmotion = topEmotions[0]?.name || 'neutral';
    const mood = MOOD_MAPPING[dominantEmotion] || 'neutral';

    // Calculate intensity (average of top 3 scores)
    const intensity = topEmotions.slice(0, 3).reduce((sum, e) => sum + e.score, 0) / 3;

    // Generate description
    const description = this.generateEmotionDescription(topEmotions, mood);

    return {
      topEmotions,
      dominantEmotion,
      mood,
      intensity,
      description,
    };
  }

  /**
   * Generate a human-readable description of the emotional state
   */
  private generateEmotionDescription(topEmotions: EmotionScore[], mood: string): string {
    if (topEmotions.length === 0) {
      return 'Ton neutre détecté.';
    }

    const primary = topEmotions[0];
    const secondary = topEmotions[1];

    const moodDescriptions: Record<string, string> = {
      happy: 'semble content(e) et positif/ve',
      sad: 'semble un peu triste ou mélancolique',
      angry: 'semble frustré(e) ou agacé(e)',
      anxious: 'semble inquiet/ète ou stressé(e)',
      calm: 'semble calme et posé(e)',
      excited: 'semble enthousiaste et énergique',
      neutral: 'a un ton neutre',
    };

    let desc = `L'utilisateur ${moodDescriptions[mood] || 'a un ton neutre'}`;

    if (secondary && secondary.score > 0.2) {
      desc += ` avec une touche de ${secondary.name}`;
    }

    if (primary.score > 0.7) {
      desc += ' (émotion forte)';
    } else if (primary.score < 0.3) {
      desc += ' (émotion légère)';
    }

    return desc + '.';
  }

  /**
   * Format emotions for LLM prompt
   */
  formatForPrompt(analysis: EmotionAnalysis): string {
    return `### Émotion Vocale Détectée
${analysis.description}
Humeur: ${analysis.mood} (intensité: ${Math.round(analysis.intensity * 100)}%)
Top émotions: ${analysis.topEmotions.slice(0, 3).map(e => `${e.name} (${Math.round(e.score * 100)}%)`).join(', ')}

Note: Adapte ta réponse à l'émotion détectée. Si la personne est triste, soit empathique. Si elle est joyeuse, partage son enthousiasme. Si elle est stressée, soit rassurante.`;
  }
}
