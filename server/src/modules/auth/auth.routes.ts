import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { env, isProd } from '@/config/env.js'
import {
  googleLoginSchema,
  authResponseSchema,
} from './auth.schema.js'
import {
  verifyGoogleIdToken,
  upsertUserFromGoogle,
  issueTokenPairAndStore,
  rotateRefreshToken,
  revokeRefreshToken,
} from './auth.service.js'

const REFRESH_COOKIE = 'refresh_token'

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/google',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: googleLoginSchema, response: { 200: authResponseSchema } },
    },
    async (req, reply) => {
      const { idToken } = req.body
      const profile = await verifyGoogleIdToken(idToken).catch(() => {
        throw app.httpErrors.unauthorized('Google verification failed')
      })
      const user = await upsertUserFromGoogle(app.prisma, profile)
      const { accessToken, refreshToken, refreshExpiresAt } = await issueTokenPairAndStore(
        app.prisma,
        user,
        req.headers['user-agent'],
        req.ip,
      )
      setRefreshCookie(reply, refreshToken, refreshExpiresAt)
      return {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          timezone: user.timezone,
        },
      }
    },
  )

  app.post(
    '/refresh',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { response: { 200: z.object({ accessToken: z.string() }) } },
    },
    async (req, reply) => {
      const token = req.cookies[REFRESH_COOKIE]
      if (!token) throw app.httpErrors.unauthorized('No refresh token')
      const rotated = await rotateRefreshToken(
        app.prisma,
        token,
        req.headers['user-agent'],
        req.ip,
      ).catch(() => {
        throw app.httpErrors.unauthorized('Invalid refresh token')
      })
      setRefreshCookie(reply, rotated.refreshToken, rotated.refreshExpiresAt)
      return { accessToken: rotated.accessToken }
    },
  )

  app.post(
    '/logout',
    {
      preHandler: app.authenticate,
      schema: { response: { 200: z.object({ ok: z.boolean() }) } },
    },
    async (req, reply) => {
      const token = req.cookies[REFRESH_COOKIE]
      if (token) await revokeRefreshToken(app.prisma, token)
      reply.clearCookie(REFRESH_COOKIE, { path: '/' })
      return { ok: true }
    },
  )
}

function setRefreshCookie(reply: import('fastify').FastifyReply, token: string, expiresAt: Date) {
  // Do NOT set `domain` for localhost — some browsers reject or mis-route
  // cookies with `domain=localhost`. Omitting `domain` makes the cookie
  // host-only for the API origin (localhost:3000), which is still sent
  // from the SPA on localhost:5173 because they're same-site.
  const isLocalhost = env.COOKIE_DOMAIN === 'localhost'
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE || isProd,
    // 'lax' lets the cookie ride on the /auth/refresh XHR after a page
    // reload. 'strict' would block some legitimate first-party flows.
    sameSite: 'lax',
    path: '/',
    ...(isLocalhost ? {} : { domain: env.COOKIE_DOMAIN }),
    expires: expiresAt,
  })
}
