import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler(
    (err: FastifyError, _req: FastifyRequest, reply: FastifyReply) => {
      const statusCode =
        err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;

      if (statusCode >= 500) {
        app.log.error(err);
      }

      return reply.code(statusCode).send({
        error: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: err.message,
      });
    },
  );
}
