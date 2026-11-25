import { config } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { createQuizServer } from './server.js';

export async function start({ installSignalHandlers = true } = {}) {
  await connectDb(config.mongoUri);
  const server = createQuizServer();

  await new Promise((resolve, reject) => {
    function onError(error) {
      server.httpServer.off('listening', onListening);
      reject(error);
    }
    function onListening() {
      server.httpServer.off('error', onError);
      resolve();
    }
    server.httpServer.once('error', onError);
    server.httpServer.once('listening', onListening);
    server.httpServer.listen(config.port, config.host);
  });

  console.log(`Quiz server listening on http://localhost:${config.port}`);
  console.log(`MongoDB: ${config.mongoUri}`);
  console.log(`Reveal screen: ${config.revealMs}ms`);

  if (installSignalHandlers) {
    let stopping = false;
    const shutdown = async (signal) => {
      if (stopping) return;
      stopping = true;
      console.log(`\n${signal} received, shutting down...`);
      try {
        await server.close();
        await disconnectDb();
        process.exit(0);
      } catch (error) {
        console.error('Shutdown failed:', error);
        process.exit(1);
      }
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  }

  return server;
}
