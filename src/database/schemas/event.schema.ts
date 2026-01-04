import mongoose, { Schema, Document } from 'mongoose';

export interface IEvent extends Document {
  userId: string;
  type: string; // job_interview, birthday, trip, deadline, etc.
  title: string;
  description?: string;
  date?: Date; // When the event happens/happened
  dateType: 'past' | 'future' | 'ongoing' | 'unknown';
  emotion?: string; // How they felt about it
  emotionIntensity?: number; // 1-10
  outcome?: 'pending' | 'success' | 'failure' | 'partial' | 'cancelled' | null;
  importance: number; // 1-10
  relatedEntities: string[]; // People, places, things involved
  relatedGoals: mongoose.Types.ObjectId[]; // Connected goals
  followUpNeeded: boolean;
  lastMentioned: Date;
  mentionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const eventSchema = new Schema<IEvent>(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true }, // job_interview, trip, deadline, birthday, etc.
    title: { type: String, required: true },
    description: String,
    date: Date,
    dateType: {
      type: String,
      enum: ['past', 'future', 'ongoing', 'unknown'],
      default: 'unknown',
    },
    emotion: String,
    emotionIntensity: { type: Number, min: 1, max: 10 },
    outcome: {
      type: String,
      enum: ['pending', 'success', 'failure', 'partial', 'cancelled', null],
      default: null,
    },
    importance: { type: Number, min: 1, max: 10, default: 5 },
    relatedEntities: [String],
    relatedGoals: [{ type: Schema.Types.ObjectId, ref: 'Goal' }],
    followUpNeeded: { type: Boolean, default: true },
    lastMentioned: { type: Date, default: Date.now },
    mentionCount: { type: Number, default: 1 },
  },
  { timestamps: true }
);

eventSchema.index({ userId: 1, date: 1 });
eventSchema.index({ userId: 1, type: 1 });
eventSchema.index({ userId: 1, importance: -1 });
eventSchema.index({ userId: 1, followUpNeeded: 1, date: 1 });

export const Event = mongoose.model<IEvent>('Event', eventSchema);
