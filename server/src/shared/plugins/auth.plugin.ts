import fp from 'fastify-plugin'
import jwt from 'jsonwebtoken'
import { env } from '@/config/env.js'

interface AccessTokenPayload {
  userId: string
  email: string
  type: 'access' | 'refresh'
}

export default fp(async (app) => {
  app.decorate('authenticate', async (req, reply) => {
    const token = extractBearer(req.headers.authorization)
    if (!token) throw app.httpErrors.unauthorized('Missing Bearer token')
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload
      if (payload.type !== 'access') throw new Error('Wrong token type')
      req.user = { userId: payload.userId, email: payload.email }
    } catch {
      throw app.httpErrors.unauthorized('Invalid or expired token')
    }
  })
})

function extractBearer(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null
  return value
}
