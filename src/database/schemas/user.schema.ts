import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  name?: string;
  preferences: {
    communicationStyle: string;
    privacyLevel: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: String,
    preferences: {
      communicationStyle: { type: String, default: 'friendly' },
      privacyLevel: { type: String, default: 'medium' },
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', userSchema);
