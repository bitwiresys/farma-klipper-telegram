import pino from 'pino';

export const loggerOptions = {
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: ['req.headers.authorization'] as string[],
    remove: true,
  },
};

export const logger = pino(loggerOptions);
