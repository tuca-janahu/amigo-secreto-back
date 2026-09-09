import { PrismaClient } from '@prisma/client';

import { config } from '../config/env.js';

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (!config.isProduction) {
  globalForPrisma.prisma = prisma;
}
