import { Resend } from 'resend';

import { config } from '../config/env.js';

export const resend = new Resend(config.resendApiKey);
