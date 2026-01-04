import mongoose, { Schema, Document } from 'mongoose';

export interface IOnboarding extends Document {
  userId: string;
  completed: boolean;
  completedAt?: Date;
  skippedAt?: Date; // User chose to skip onboarding

  // Phase 1: Identity
  name?: string;
  profession?: string;
  hiddenTrait?: string;

  // Phase 2: Situation
  currentSituation?: string;
  currentEmotion?: string;
  typicalDay?: string;

  // Phase 3: Values
  values?: string[];
  hobbies?: string[];

  // Phase 4: Goals
  goals?: string[];
  yearlyTarget?: string;

  // Phase 5: Communication
  communicationStyle?: string;

  // Metadata
  responses?: Array<{
    question: number;
    answer: string;
    skipped: boolean;
    timestamp: Date;
  }>;

  createdAt: Date;
  updatedAt: Date;
}

const onboardingSchema = new Schema<IOnboarding>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    completed: { type: Boolean, default: false },
    completedAt: Date,
    skippedAt: Date,

    // Phase 1
    name: String,
    profession: String,
    hiddenTrait: String,

    // Phase 2
    currentSituation: String,
    currentEmotion: String,
    typicalDay: String,

    // Phase 3
    values: [String],
    hobbies: [String],

    // Phase 4
    goals: [String],
    yearlyTarget: String,

    // Phase 5
    communicationStyle: String,

    responses: [{
      question: Number,
      answer: String,
      skipped: { type: Boolean, default: false },
      timestamp: { type: Date, default: Date.now }
    }]
  },
  { timestamps: true }
);

export const Onboarding = mongoose.model<IOnboarding>('Onboarding', onboardingSchema);
