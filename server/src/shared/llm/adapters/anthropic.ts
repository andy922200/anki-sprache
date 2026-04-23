import Anthropic from '@anthropic-ai/sdk'
import type { LlmAdapter, LlmCompletionInput, LlmCompletionOutput } from '../llmClient.js'
import { retryable } from '../retry.js'

export function createAnthropicAdapter(
  apiKey: string,
  model = 'claude-sonnet-4-6',
): LlmAdapter {
  const client = new Anthropic({ apiKey })
  return {
    provider: 'ANTHROPIC',
    model,
    async complete(input: LlmCompletionInput): Promise<LlmCompletionOutput> {
      const res = await retryable(() =>
        client.messages.create({
          model,
          max_tokens: 2048,
          temperature: 0.5,
          system: input.system + '\n\nAlways respond with a single JSON object and no prose.',
          messages: [{ role: 'user', content: input.user }],
        }),
      )
      const content = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      return {
        content,
        promptTokens: res.usage.input_tokens,
        completionTokens: res.usage.output_tokens,
      }
    },
  }
}
