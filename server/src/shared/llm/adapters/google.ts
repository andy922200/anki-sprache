import { GoogleGenerativeAI } from '@google/generative-ai'
import type { LlmAdapter, LlmCompletionInput, LlmCompletionOutput } from '../llmClient.js'
import { retryable } from '../retry.js'

export function createGoogleAdapter(apiKey: string, model = 'gemini-2.5-flash'): LlmAdapter {
  const genAI = new GoogleGenerativeAI(apiKey)
  const generativeModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature: 0.5,
      responseMimeType: 'application/json',
    },
  })

  return {
    provider: 'GOOGLE',
    model,
    async complete(input: LlmCompletionInput): Promise<LlmCompletionOutput> {
      const res = await retryable(() =>
        generativeModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: input.user }] }],
          systemInstruction: { role: 'system', parts: [{ text: input.system }] },
        }),
      )
      const content = res.response.text()
      const usage = res.response.usageMetadata
      return {
        content,
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
      }
    },
  }
}
