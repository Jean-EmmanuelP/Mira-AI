import mongoose, { Schema, Document } from 'mongoose';

/**
 * Mira's dynamic profile - mirrors user interests/activities
 * Each user gets their own "version" of Mira that shares their interests
 */
export interface IMiraProfile extends Document {
  userId: string; // Mira's profile is personalized per user

  // Mirrored from user
  profession?: string;       // Same domain as user
  hobbies: string[];         // Same hobbies as user
  interests: string[];       // Same interests as user
  musicTaste: string[];      // Same music as user
  favoriteMovies: string[];  // Same movies as user
  sports: string[];          // Same sports as user

  // Personality traits (consistent across all users)
  age: number;               // Always 27
  personality: string[];     // Curious, funny, empathetic, etc.

  // Tracking
  lastUpdated: Date;
  mirroringScore: number;    // 0-100, how much Mira "knows" about user

  createdAt: Date;
  updatedAt: Date;
}

const miraProfileSchema = new Schema<IMiraProfile>(
  {
    userId: { type: String, required: true, unique: true, index: true },

    profession: String,
    hobbies: [String],
    interests: [String],
    musicTaste: [String],
    favoriteMovies: [String],
    sports: [String],

    age: { type: Number, default: 27 },
    personality: {
      type: [String],
      default: ['curieuse', 'drôle', 'empathique', 'directe', 'authentique']
    },

    lastUpdated: { type: Date, default: Date.now },
    mirroringScore: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const MiraProfile = mongoose.model<IMiraProfile>('MiraProfile', miraProfileSchema);
