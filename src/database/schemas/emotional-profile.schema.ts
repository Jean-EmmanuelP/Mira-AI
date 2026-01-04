import mongoose, { Schema, Document } from 'mongoose';

export interface EmotionalTrigger {
  topic: string;
  emotions: Record<string, number>; // { stress: 0.7, excitement: 0.3 }
  occurrences: number;
}

export interface CopingMechanism {
  method: string;
  effectiveness: number; // 0-1
  timesUsed: number;
}

export interface IEmotionalProfile extends Document {
  userId: string;
  baseline: string; // optimistic, neutral, anxious, etc.
  triggers: EmotionalTrigger[];
  copingMechanisms: CopingMechanism[];
  averageMessageFrequency: number; // messages per day
  lastInteraction: Date;
  conversationStreak: number; // days in a row
  longestStreak: number;
  totalConversations: number;
  emotionHistory: Array<{
    date: Date;
    dominantEmotion: string;
    intensity: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const emotionalProfileSchema = new Schema<IEmotionalProfile>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    baseline: { type: String, default: 'neutral' },
    triggers: [
      {
        topic: String,
        emotions: { type: Map, of: Number },
        occurrences: { type: Number, default: 1 },
      },
    ],
    copingMechanisms: [
      {
        method: String,
        effectiveness: { type: Number, min: 0, max: 1, default: 0.5 },
        timesUsed: { type: Number, default: 1 },
      },
    ],
    averageMessageFrequency: { type: Number, default: 0 },
    lastInteraction: { type: Date, default: Date.now },
    conversationStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    totalConversations: { type: Number, default: 0 },
    emotionHistory: [
      {
        date: Date,
        dominantEmotion: String,
        intensity: { type: Number, min: 1, max: 10 },
      },
    ],
  },
  { timestamps: true }
);

export const EmotionalProfile = mongoose.model<IEmotionalProfile>(
  'EmotionalProfile',
  emotionalProfileSchema
);
