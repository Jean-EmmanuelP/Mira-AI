import mongoose, { Schema, Document } from 'mongoose';

export interface IGoal extends Document {
  userId: string;
  goal: string;
  status: 'active' | 'completed' | 'paused';
  progress: number;
  targetDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const goalSchema = new Schema<IGoal>(
  {
    userId: { type: String, required: true, index: true },
    goal: { type: String, required: true },
    status: { type: String, default: 'active' },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    targetDate: Date,
  },
  { timestamps: true }
);

export const Goal = mongoose.model<IGoal>('Goal', goalSchema);
