import fp from 'fastify-plugin'
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod'
import { isDev } from '@/config/env.js'

export default fp(async (app) => {
  app.setErrorHandler((error, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid request payload',
        issues: error.validation,
      })
    }

    if (isResponseSerializationError(error)) {
      req.log.error({ err: error }, 'Response serialization failed')
      return reply.status(500).send({
        error: 'ResponseSerializationError',
        message: isDev ? error.message : 'Response serialization failed',
      })
    }

    const anyErr = error as { statusCode?: number; name?: string; message?: string }
    if (typeof anyErr.statusCode === 'number') {
      return reply.status(anyErr.statusCode).send({
        error: anyErr.name || 'Error',
        message: anyErr.message ?? 'Error',
      })
    }

    req.log.error({ err: error }, 'Unhandled error')
    return reply.status(500).send({
      error: 'InternalServerError',
      message: isDev ? (anyErr.message ?? 'error') : 'Something went wrong',
    })
  })

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: 'NotFound',
      message: `Route ${req.method} ${req.url} not found`,
    })
  })
})
