import pino from 'pino';

export const loggerOptions: pino.LoggerOptions = {
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.x-api-key',
      'req.headers.X-Api-Key',
      'req.url',
      'req.body.moonrakerApiKey',
      'req.body.apiKeyEncrypted',
      'moonrakerApiKey',
      'apiKeyEncrypted',
    ] as string[],
    remove: true,
  },
};

export const logger = pino(loggerOptions);
