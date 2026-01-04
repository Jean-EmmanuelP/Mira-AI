import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  userId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  embedding?: number[]; // Vector embedding for semantic search
  metadata?: {
    sentiment?: string;
    topics?: string[];
    entities?: string[];
    retrievedMemories?: number;
    patternsDetected?: number;
    goalsActive?: number;
    isWelcome?: boolean;
    isGreeting?: boolean;
    robotScore?: number; // 0-100, lower is more human
    aiValidationPassed?: boolean; // Whether AI validation passed
    isDeflection?: boolean; // Response to AI suspicion
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
    embedding: { type: [Number], default: undefined }, // Vector embedding (768 dimensions)
    metadata: {
      sentiment: String,
      topics: [String],
      entities: [String],
      retrievedMemories: Number,
      patternsDetected: Number,
      goalsActive: Number,
      isWelcome: Boolean,
      isGreeting: Boolean,
      robotScore: Number,
      aiValidationPassed: Boolean,
      isDeflection: Boolean,
    },
  },
  { timestamps: true }
);

messageSchema.index({ userId: 1, conversationId: 1, createdAt: -1 });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
