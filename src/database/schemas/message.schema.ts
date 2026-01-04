import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  userId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    sentiment?: string;
    topics?: string[];
    entities?: string[];
    retrievedMemories?: number;
    patternsDetected?: number;
    goalsActive?: number;
    isWelcome?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    userId: { type: String, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    metadata: {
      sentiment: String,
      topics: [String],
      entities: [String],
      retrievedMemories: Number,
      patternsDetected: Number,
      goalsActive: Number,
      isWelcome: Boolean,
    },
  },
  { timestamps: true }
);

messageSchema.index({ userId: 1, conversationId: 1, createdAt: -1 });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
