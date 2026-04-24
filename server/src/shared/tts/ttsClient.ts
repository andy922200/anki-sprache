import { createGoogleTtsAdapter } from './adapters/google.js'

export type TtsProvider = 'GOOGLE'

export interface TtsAdapter {
  provider: TtsProvider
  synthesize: (input: TtsSynthesizeInput) => Promise<Buffer>
}

export interface TtsSynthesizeInput {
  text: string
  /** Language code as stored on `Language.code` — e.g. 'de', 'en', 'ja', 'zh', 'pt'. */
  languageCode: string
}

export function buildTtsAdapter(provider: TtsProvider = 'GOOGLE'): TtsAdapter {
  switch (provider) {
    case 'GOOGLE':
      return createGoogleTtsAdapter()
  }
}
