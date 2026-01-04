import mongoose, { Schema, Document } from 'mongoose';

export type ActivityCategory = 'tech' | 'hobby' | 'sports' | 'passion' | 'work' | 'learning' | 'other';

export interface IActivityTag {
  name: string;
  category?: ActivityCategory;
  confidence: number;
  frequency: number;
  firstMentioned: Date;
  lastMentioned: Date;
  relevanceScore?: number;
}

export interface IUserActivity extends Document {
  userId: string;

  // Core activity tracking
  activities: IActivityTag[];

  // Profile completeness (0-1)
  profileCompleteness: number;

  // Event tracking
  lastEventMentionedAt?: Date;
  eventsMentionedCount: number;

  // Timestamps
  lastActivityExtractedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const activityTagSchema = new Schema<IActivityTag>(
  {
    name: { type: String, required: true, lowercase: true, trim: true },
    category: {
      type: String,
      enum: ['tech', 'hobby', 'sports', 'passion', 'work', 'learning', 'other'],
      default: 'other'
    },
    confidence: { type: Number, min: 0, max: 1, default: 0.5 },
    frequency: { type: Number, default: 1 },
    firstMentioned: { type: Date, default: () => new Date() },
    lastMentioned: { type: Date, default: () => new Date() },
    relevanceScore: { type: Number, min: 0, max: 1 }
  },
  { _id: false }
);

const userActivitySchema = new Schema<IUserActivity>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    activities: [activityTagSchema],

    profileCompleteness: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },

    lastEventMentionedAt: Date,
    eventsMentionedCount: { type: Number, default: 0 },

    lastActivityExtractedAt: Date
  },
  { timestamps: true }
);

// Indexes for efficient lookups
userActivitySchema.index({ 'activities.name': 1 });
userActivitySchema.index({ userId: 1, 'activities.lastMentioned': -1 });

export const UserActivity = mongoose.model<IUserActivity>('UserActivity', userActivitySchema);
