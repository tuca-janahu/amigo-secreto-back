import type { Request } from 'express';

export type PublicUser = {
  id: string;
  name: string;
  email: string;
};

export type AuthenticatedRequest = Request & {
  auth: {
    userId: string;
  };
};
