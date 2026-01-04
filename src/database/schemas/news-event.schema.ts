import mongoose, { Schema, Document } from 'mongoose';

export type NewsSource = 'hackernews' | 'rss' | 'twitter' | 'reddit' | 'manual';

export interface INewsEvent extends Document {
  title: string;
  description?: string;
  source: NewsSource;
  url: string;
  imageUrl?: string;

  // Tags for matching with user activities
  tags: string[];

  // Metadata
  publishedAt?: Date;
  fetchedAt: Date;
  expiresAt: Date;

  // Track which users saw this event
  mentionedTo: {
    userId: string;
    mentionedAt: Date;
  }[];

  // Cached relevance
  relevanceScore?: number;

  createdAt: Date;
  updatedAt: Date;
}

const newsEventSchema = new Schema<INewsEvent>(
  {
    title: { type: String, required: true },
    description: String,
    source: {
      type: String,
      enum: ['hackernews', 'rss', 'twitter', 'reddit', 'manual'],
      required: true
    },
    url: { type: String, required: true, unique: true },
    imageUrl: String,

    tags: [{ type: String, lowercase: true, trim: true }],

    publishedAt: Date,
    fetchedAt: { type: Date, default: () => new Date() },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days TTL
    },

    mentionedTo: [{
      userId: String,
      mentionedAt: Date
    }],

    relevanceScore: { type: Number, min: 0, max: 1 }
  },
  { timestamps: true }
);

// TTL index: automatically delete events after expiresAt
newsEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
newsEventSchema.index({ tags: 1, fetchedAt: -1 });
newsEventSchema.index({ source: 1, fetchedAt: -1 });

export const NewsEvent = mongoose.model<INewsEvent>('NewsEvent', newsEventSchema);
