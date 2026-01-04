import WebSocket from 'ws';

export class GradiumService {
  private apiKey: string;
  private sttEndpoint = 'wss://eu.api.gradium.ai/api/speech/asr';
  private ttsEndpoint = 'wss://eu.api.gradium.ai/api/speech/tts';
  private voiceId = 'YTpq7expH9539ERJ'; // Default female voice

  constructor() {
    this.apiKey = process.env.GRADIUM_API_KEY || '';
    if (!this.apiKey) {
      console.warn('⚠️ GRADIUM_API_KEY not set - STT/TTS disabled');
    }
  }

  isEnabled(): boolean {
    return !!this.apiKey;
  }

  /**
   * Speech-to-Text: Convert audio buffer to text
   */
  async speechToText(audioBase64: string, inputFormat: string = 'wav'): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GRADIUM_API_KEY not configured');
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.sttEndpoint, {
        headers: { 'x-api-key': this.apiKey },
      });

      let transcription = '';
      let isReady = false;

      ws.on('open', () => {
        // Send setup message
        ws.send(JSON.stringify({
          type: 'setup',
          model_name: 'default',
          input_format: inputFormat,
        }));
      });

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'ready') {
            isReady = true;
            // Send audio data
            ws.send(JSON.stringify({
              type: 'audio',
              audio: audioBase64,
            }));
            // Signal end of stream
            ws.send(JSON.stringify({ type: 'end_of_stream' }));
          }

          if (msg.type === 'text') {
            transcription += msg.text + ' ';
          }

          if (msg.type === 'end_text') {
            ws.close();
            resolve(transcription.trim());
          }
        } catch (error) {
          console.error('STT parse error:', error);
        }
      });

      ws.on('error', (error: Error) => {
        console.error('STT WebSocket error:', error);
        reject(error);
      });

      ws.on('close', () => {
        if (transcription) {
          resolve(transcription.trim());
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
          resolve(transcription.trim() || '');
        }
      }, 30000);
    });
  }

  /**
   * Text-to-Speech: Convert text to audio buffer
   */
  async textToSpeech(text: string, outputFormat: string = 'wav'): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GRADIUM_API_KEY not configured');
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.ttsEndpoint, {
        headers: { 'x-api-key': this.apiKey },
      });

      const audioChunks: string[] = [];

      ws.on('open', () => {
        // Send setup message
        ws.send(JSON.stringify({
          type: 'setup',
          model_name: 'default',
          voice_id: this.voiceId,
          output_format: outputFormat,
        }));
      });

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'ready') {
            // Send text to convert
            ws.send(JSON.stringify({
              type: 'text',
              text: text,
            }));
            // Signal end of stream
            ws.send(JSON.stringify({ type: 'end_of_stream' }));
          }

          if (msg.type === 'audio' && msg.audio) {
            audioChunks.push(msg.audio);
          }

          if (msg.type === 'end_of_stream' || msg.type === 'done') {
            ws.close();
            // Combine all audio chunks
            const fullAudio = audioChunks.join('');
            resolve(fullAudio);
          }
        } catch (error) {
          console.error('TTS parse error:', error);
        }
      });

      ws.on('error', (error: Error) => {
        console.error('TTS WebSocket error:', error);
        reject(error);
      });

      ws.on('close', () => {
        if (audioChunks.length > 0) {
          resolve(audioChunks.join(''));
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
          if (audioChunks.length > 0) {
            resolve(audioChunks.join(''));
          } else {
            reject(new Error('TTS timeout'));
          }
        }
      }, 30000);
    });
  }

  /**
   * Random TTS decision - returns true ~25% of the time (1 in 4)
   * Uses weighted randomness to feel more natural
   */
  shouldSendVoiceResponse(): boolean {
    // Random number between 0 and 100
    const random = Math.random() * 100;
    // ~25% chance, but with some variance
    return random < 25;
  }
}
