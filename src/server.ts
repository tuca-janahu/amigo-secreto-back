import { app } from './app.js';
import { config } from './config/env.js';
import { prisma } from './lib/prisma.js';

const server = app.listen(config.port, () => {
  console.info(`Servidor HTTP iniciado na porta ${config.port}.`);
});

let isShuttingDown = false;

const shutdown = (signal: NodeJS.Signals): void => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.info(`Encerrando servidor após ${signal}.`);

  server.close((serverError) => {
    void prisma.$disconnect().catch(() => {
      process.exitCode = 1;
    });

    if (serverError) {
      process.exitCode = 1;
    }
  });
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
