import { createHash } from 'node:crypto'
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { env } from '@/config/env.js'

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
})

export type AudioKind = 'lemma' | 'example'

export function buildAudioKey(kind: AudioKind, languageCode: string, text: string): string {
  const hash = createHash('sha256').update(text).digest('hex')
  return `audio/${kind}/${languageCode}/${hash}.mp3`
}

export function extractKeyFromUrl(url: string): string | null {
  const prefix = env.R2_PUBLIC_URL.replace(/\/$/, '')
  if (!url.startsWith(prefix)) return null
  return url.slice(prefix.length + 1)
}

export function publicUrlFor(key: string): string {
  return `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
}

export async function uploadAudio(
  key: string,
  body: Buffer,
  metadata?: Record<string, string>,
): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'audio/mpeg',
      CacheControl: 'public, max-age=31536000, immutable',
      // R2 / S3 metadata keys must be ASCII; non-ASCII values are safest when
      // URL-encoded by the caller.
      Metadata: metadata,
    }),
  )
  return publicUrlFor(key)
}

export async function deleteAudio(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))
    return true
  } catch (err) {
    const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } }).name
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) return false
    throw err
  }
}
