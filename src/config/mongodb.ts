import mongoose, { Connection } from 'mongoose';

let cachedConnection: Connection | null = null;

export async function connectMongoDB(): Promise<Connection> {
  if (cachedConnection) {
    console.log('Using cached MongoDB connection');
    return cachedConnection;
  }

  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/mira';

    await mongoose.connect(uri, {
      retryWrites: true,
      w: 'majority',
    });

    cachedConnection = mongoose.connection;
    console.log('✅ MongoDB connected successfully');

    return cachedConnection;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
}

export async function disconnectMongoDB(): Promise<void> {
  if (cachedConnection) {
    await mongoose.disconnect();
    cachedConnection = null;
    console.log('MongoDB disconnected');
  }
}
