import OpenAI from 'openai'
import type { LlmAdapter, LlmCompletionInput, LlmCompletionOutput } from '../llmClient.js'
import { retryable } from '../retry.js'

export function createOpenAIAdapter(apiKey: string, model = 'gpt-4o-mini'): LlmAdapter {
  const client = new OpenAI({ apiKey })
  return {
    provider: 'OPENAI',
    model,
    async complete(input: LlmCompletionInput): Promise<LlmCompletionOutput> {
      const res = await retryable(() =>
        client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          temperature: 0.5,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
        }),
      )
      const content = res.choices[0]?.message?.content ?? ''
      return {
        content,
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
      }
    },
  }
}
