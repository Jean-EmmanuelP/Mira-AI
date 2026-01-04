import mongoose, { Schema, Document } from 'mongoose';

export interface ISemanticMemory extends Document {
  userId: string;
  fact: string;
  category: string;
  confidence: number;
  embedding?: number[];
  mentionCount: number;
  firstMentioned: Date;
  lastMentioned: Date;
  relationships?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const memorySchema = new Schema<ISemanticMemory>(
  {
    userId: { type: String, required: true, index: true },
    fact: { type: String, required: true },
    category: {
      type: String,
      enum: ['personal', 'professional', 'health', 'goals', 'preferences', 'relationship', 'emotional'],
      required: true,
    },
    confidence: { type: Number, min: 0, max: 1, default: 0.5 },
    embedding: [Number],
    mentionCount: { type: Number, default: 1 },
    firstMentioned: { type: Date, default: Date.now },
    lastMentioned: { type: Date, default: Date.now },
    relationships: [String],
  },
  { timestamps: true }
);

memorySchema.index({ userId: 1, lastMentioned: -1 });
memorySchema.index({ userId: 1, category: 1 });

export const SemanticMemory = mongoose.model<ISemanticMemory>('SemanticMemory', memorySchema);
