import { app } from './app.js';
import { config } from './config/env.js';

app.listen(config.port, () => {
  console.info(`HTTP server listening on port ${config.port}.`);
});
