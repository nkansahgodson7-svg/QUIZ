import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.JWT_SECRET ||= 'dev-memory-secret-change-me';

// Config is read on first import, so import the app after setting MONGO_URI.
const { start } = await import('../src/bootstrap.js');
const { disconnectDb } = await import('../src/db.js');

const server = await start({ installSignalHandlers: false });
console.log(`In-memory MongoDB: ${mongod.getUri()}`);
console.log('This mode is for local development only. Press ctrl+c to stop.');

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} received, shutting down...`);
  try {
    await server.close();
    await disconnectDb();
    await mongod.stop();
    process.exit(0);
  } catch (error) {
    console.error('Shutdown failed:', error);
    process.exit(1);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
