import { env } from '@/config/env.js'
import { retryable } from '@/shared/llm/retry.js'
import type { TtsAdapter, TtsSynthesizeInput } from '../ttsClient.js'

// Maps the app's short language codes (stored on Language.code) to Google
// Cloud TTS BCP-47 locale + a default Wavenet voice. Wavenet is the sweet
// spot between quality and cost ($16/1M chars).
const VOICE_MAP: Record<string, { languageCode: string; name: string }> = {
  de: { languageCode: 'de-DE', name: 'de-DE-Wavenet-F' },
  en: { languageCode: 'en-US', name: 'en-US-Wavenet-F' },
  ja: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-A' },
  pt: { languageCode: 'pt-BR', name: 'pt-BR-Wavenet-A' },
  zh: { languageCode: 'cmn-TW', name: 'cmn-TW-Wavenet-A' },
  fr: { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-A' },
  es: { languageCode: 'es-ES', name: 'es-ES-Wavenet-B' },
}

const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'

interface GoogleTtsResponse {
  audioContent?: string
  error?: { message?: string; code?: number }
}

class GoogleTtsError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function createGoogleTtsAdapter(): TtsAdapter {
  return {
    provider: 'GOOGLE',
    async synthesize(input: TtsSynthesizeInput): Promise<Buffer> {
      const voice = VOICE_MAP[input.languageCode]
      if (!voice) {
        throw new Error(`Unsupported TTS language: ${input.languageCode}`)
      }

      const body = {
        input: { text: input.text },
        voice,
        audioConfig: {
          audioEncoding: 'MP3',
          sampleRateHertz: 22050,
        },
      }

      const result = await retryable(async () => {
        const res = await fetch(`${ENDPOINT}?key=${env.GOOGLE_TTS_API_KEY}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = (await res.json()) as GoogleTtsResponse
        if (!res.ok || !json.audioContent) {
          const message = json.error?.message ?? `Google TTS ${res.status}`
          throw new GoogleTtsError(message, res.status)
        }
        return json.audioContent
      })

      return Buffer.from(result, 'base64')
    },
  }
}
