import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { env } from '@/config/env.js'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12

function masterKey(): Buffer {
  return Buffer.from(env.MASTER_KEY, 'base64')
}

export interface EncryptedBlob {
  encryptedKey: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
  authTag: Uint8Array<ArrayBuffer>
  keyFingerprint: string
}

function cloneToU8(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(src.byteLength))
  out.set(src)
  return out
}

export function encryptSecret(plaintext: string): EncryptedBlob {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, masterKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const fingerprint = createHash('sha256').update(plaintext).digest('hex').slice(0, 12)
  return {
    encryptedKey: cloneToU8(encrypted),
    iv: cloneToU8(iv),
    authTag: cloneToU8(authTag),
    keyFingerprint: fingerprint,
  }
}

export function decryptSecret(blob: {
  encryptedKey: Buffer | Uint8Array
  iv: Buffer | Uint8Array
  authTag: Buffer | Uint8Array
}): string {
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(blob.iv))
  decipher.setAuthTag(Buffer.from(blob.authTag))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.encryptedKey)),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}
