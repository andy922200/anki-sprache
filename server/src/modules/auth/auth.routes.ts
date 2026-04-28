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
      reply.clearCookie(REFRESH_COOKIE, refreshCookieAttributes())
      return { ok: true }
    },
  )
}

// Shared cookie attributes — used by both setCookie and clearCookie. For
// browsers to delete a cookie, the (name, domain, path) tuple must match
// what was originally set; reusing the same attributes keeps the two paths
// aligned.
function refreshCookieAttributes() {
  // Do NOT set `domain` for localhost — some browsers reject or mis-route
  // cookies with `domain=localhost`. Omitting `domain` makes the cookie
  // host-only for the API origin (localhost:3000), which is still sent
  // from the SPA on localhost:5173 because they're same-site.
  const isLocalhost = env.COOKIE_DOMAIN === 'localhost'
  // Browsers reject sameSite=none unless the cookie is also Secure, so we
  // upgrade to Secure whenever the deployment opted into 'none'.
  const secure = env.COOKIE_SECURE || isProd || env.COOKIE_SAMESITE === 'none'
  return {
    httpOnly: true,
    secure,
    // 'lax' is the safer default for same-site setups. Cross-site
    // deployments (e.g. anki-sprache.zeabur.app ↔ api-anki-sprache.zeabur.app
    // — *.zeabur.app is on the public suffix list, so the browser treats
    // them as cross-site) must opt into 'none' so XHR carries the cookie.
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    ...(isLocalhost ? {} : { domain: env.COOKIE_DOMAIN }),
  } as const
}

function setRefreshCookie(reply: import('fastify').FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(REFRESH_COOKIE, token, { ...refreshCookieAttributes(), expires: expiresAt })
}
