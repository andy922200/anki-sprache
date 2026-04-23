import type { LlmProvider, PrismaClient } from '@prisma/client'
import { decryptSecret } from '@/shared/crypto/aesGcm.js'
import { createOpenAIAdapter } from './adapters/openai.js'
import { createAnthropicAdapter } from './adapters/anthropic.js'
import { createGoogleAdapter } from './adapters/google.js'

export interface LlmCompletionInput {
  system: string
  user: string
}

export interface LlmCompletionOutput {
  content: string
  promptTokens: number
  completionTokens: number
}

export interface LlmAdapter {
  provider: LlmProvider
  model: string
  complete: (input: LlmCompletionInput) => Promise<LlmCompletionOutput>
}

export function buildAdapter(
  provider: LlmProvider,
  apiKey: string,
  model?: string | null,
): LlmAdapter {
  // Treat empty string as unset so the adapter's default model kicks in.
  const m = model && model.trim().length > 0 ? model : undefined
  switch (provider) {
    case 'OPENAI':
      return createOpenAIAdapter(apiKey, m)
    case 'ANTHROPIC':
      return createAnthropicAdapter(apiKey, m)
    case 'GOOGLE':
      return createGoogleAdapter(apiKey, m)
  }
}

export async function getAdapterForUser(
  prisma: PrismaClient,
  userId: string,
  provider: LlmProvider,
  model?: string | null,
): Promise<LlmAdapter> {
  const record = await prisma.llmApiKey.findUnique({
    where: { userId_provider: { userId, provider } },
  })
  if (!record) throw new Error(`No API key for provider ${provider}`)
  const apiKey = decryptSecret({
    encryptedKey: record.encryptedKey,
    iv: record.iv,
    authTag: record.authTag,
  })
  return buildAdapter(provider, apiKey, model)
}
