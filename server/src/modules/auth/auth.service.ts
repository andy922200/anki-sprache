import { createHash, randomBytes } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import type { PrismaClient, User } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { env } from '@/config/env.js'

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID)

export interface VerifiedGoogleProfile {
  sub: string
  email: string
  name: string
  picture?: string
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleProfile> {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Invalid Google ID token payload')
  }
  if (!payload.email_verified) {
    throw new Error('Google email is not verified')
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split('@')[0]!,
    picture: payload.picture,
  }
}

export async function upsertUserFromGoogle(
  prisma: PrismaClient,
  profile: VerifiedGoogleProfile,
): Promise<User> {
  const existing = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: profile.sub } },
    include: { user: true },
  })
  if (existing) return existing.user

  // First-time login: create user + OAuthAccount + default settings in a transaction
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.upsert({
      where: { email: profile.email },
      update: { displayName: profile.name, avatarUrl: profile.picture ?? null },
      create: {
        email: profile.email,
        displayName: profile.name,
        avatarUrl: profile.picture ?? null,
      },
    })
    await tx.oAuthAccount.create({
      data: { userId: u.id, provider: 'GOOGLE', providerAccountId: profile.sub },
    })
    await tx.userSettings.upsert({
      where: { userId: u.id },
      update: {},
      create: {
        userId: u.id,
        targetLanguageCode: 'de',
        nativeLanguageCode: 'en',
        cefrLevel: 'A1',
      },
    })
    return u
  })
  return user
}

export function signAccessToken(user: Pick<User, 'id' | 'email'>): string {
  return jwt.sign(
    { userId: user.id, email: user.email, type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] },
  )
}

export function signRefreshToken(user: Pick<User, 'id' | 'email'>): {
  token: string
  expiresAt: Date
} {
  const rawId = randomBytes(32).toString('hex')
  const token = jwt.sign(
    { userId: user.id, email: user.email, type: 'refresh', jti: rawId },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.REFRESH_TOKEN_TTL as jwt.SignOptions['expiresIn'] },
  )
  const expiresAt = decodeExpiry(token) ?? new Date(Date.now() + 30 * 24 * 3600 * 1000)
  return { token, expiresAt }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function decodeExpiry(token: string): Date | null {
  const decoded = jwt.decode(token)
  if (!decoded || typeof decoded !== 'object' || !decoded.exp) return null
  return new Date(decoded.exp * 1000)
}

export function verifyRefreshToken(token: string): { userId: string; email: string } {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
    userId: string
    email: string
    type: string
  }
  if (payload.type !== 'refresh') throw new Error('Wrong token type')
  return { userId: payload.userId, email: payload.email }
}

export async function issueTokenPairAndStore(
  prisma: PrismaClient,
  user: User,
  userAgent?: string,
  ip?: string,
): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date }> {
  const accessToken = signAccessToken(user)
  const { token: refreshToken, expiresAt } = signRefreshToken(user)
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      userAgent: userAgent ?? null,
      ip: ip ?? null,
    },
  })
  return { accessToken, refreshToken, refreshExpiresAt: expiresAt }
}

export async function rotateRefreshToken(
  prisma: PrismaClient,
  oldToken: string,
  userAgent?: string,
  ip?: string,
): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date; user: User }> {
  const payload = verifyRefreshToken(oldToken)
  const oldHash = hashRefreshToken(oldToken)

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: oldHash } })
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new Error('Refresh token is invalid or revoked')
  }
  if (stored.userId !== payload.userId) {
    throw new Error('Refresh token user mismatch')
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user) throw new Error('User not found')

  const issued = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    })
    const pair = await issueTokenPairAndStoreTx(tx, user, userAgent, ip)
    return pair
  })

  return { ...issued, user }
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

async function issueTokenPairAndStoreTx(
  tx: Tx,
  user: User,
  userAgent?: string,
  ip?: string,
): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date }> {
  const accessToken = signAccessToken(user)
  const { token: refreshToken, expiresAt } = signRefreshToken(user)
  await tx.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      userAgent: userAgent ?? null,
      ip: ip ?? null,
    },
  })
  return { accessToken, refreshToken, refreshExpiresAt: expiresAt }
}

export async function revokeRefreshToken(prisma: PrismaClient, token: string): Promise<void> {
  const hash = hashRefreshToken(token)
  await prisma.refreshToken
    .update({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })
    .catch(() => {
      /* idempotent */
    })
}
