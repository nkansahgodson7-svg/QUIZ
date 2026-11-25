import { start } from './bootstrap.js';

start().catch((error) => {
  console.error('Failed to start quiz server:', error);
  process.exit(1);
});
