import mongoose, { Schema, Document } from 'mongoose';

export type RelationshipLevel = 0 | 1 | 2 | 3;
export type RelationshipLabel = 'stranger' | 'acquaintance' | 'personal' | 'deep_relational';

export interface IUserRelationship extends Document {
  userId: string;

  // Core metrics
  firstSeenAt: Date;
  lastInteractionAt: Date;
  totalMessages: number;
  distinctDaysActive: number;
  totalConversations: number;

  // Relationship state
  depthLevel: RelationshipLevel;
  depthLabel: RelationshipLabel;
  depthScore: number; // 0-1 raw score

  // Tracking what we know
  knowledgeAreas: {
    identity: boolean;      // name, profession
    situation: boolean;     // current life context
    values: boolean;        // what matters to them
    goals: boolean;         // objectives, aspirations
    emotions: boolean;      // emotional patterns
    interests: boolean;     // hobbies, activities
    relationships: boolean; // people in their life
  };

  // What's missing (to guide questions)
  missingInfo: string[];

  // Engagement quality
  averageMessageLength: number;
  emotionalOpenness: number; // 0-1, how much they share emotions
  initiationRate: number;    // 0-1, how often they start conversations

  // Milestones
  milestones: Array<{
    type: string;
    achievedAt: Date;
    description?: string;
  }>;

  createdAt: Date;
  updatedAt: Date;
}

const userRelationshipSchema = new Schema<IUserRelationship>(
  {
    userId: { type: String, required: true, unique: true, index: true },

    // Core metrics
    firstSeenAt: { type: Date, default: Date.now },
    lastInteractionAt: { type: Date, default: Date.now },
    totalMessages: { type: Number, default: 0 },
    distinctDaysActive: { type: Number, default: 0 },
    totalConversations: { type: Number, default: 0 },

    // Relationship state
    depthLevel: { type: Number, default: 0, min: 0, max: 3 },
    depthLabel: {
      type: String,
      enum: ['stranger', 'acquaintance', 'personal', 'deep_relational'],
      default: 'stranger'
    },
    depthScore: { type: Number, default: 0, min: 0, max: 1 },

    // Knowledge tracking
    knowledgeAreas: {
      identity: { type: Boolean, default: false },
      situation: { type: Boolean, default: false },
      values: { type: Boolean, default: false },
      goals: { type: Boolean, default: false },
      emotions: { type: Boolean, default: false },
      interests: { type: Boolean, default: false },
      relationships: { type: Boolean, default: false },
    },

    missingInfo: [{ type: String }],

    // Engagement quality
    averageMessageLength: { type: Number, default: 0 },
    emotionalOpenness: { type: Number, default: 0 },
    initiationRate: { type: Number, default: 0 },

    // Milestones
    milestones: [{
      type: { type: String, required: true },
      achievedAt: { type: Date, default: Date.now },
      description: String,
    }],
  },
  { timestamps: true }
);

export const UserRelationship = mongoose.model<IUserRelationship>('UserRelationship', userRelationshipSchema);
