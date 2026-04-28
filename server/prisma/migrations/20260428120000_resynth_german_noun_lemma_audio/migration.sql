-- Force re-synthesis of lemma audio for German nouns. After this migration
-- the audio service uses "<article> <noun>" (e.g. "die Stadt") as the TTS
-- source for cards with a gender, but existing rows still point at the old
-- bare-noun (or capital-D-prefixed legacy) mp3. Nulling audioUrl makes the
-- next playback hit the new content-addressed key and synthesize fresh
-- audio that matches the UI.
--
-- The orphan mp3 objects on R2 can be cleaned up afterwards with:
--   pnpm --filter ./server audit:audio --delete --confirm
--
-- Idempotent: a card whose audioUrl is already NULL is skipped.

UPDATE "VocabularyCard"
SET "audioUrl" = NULL
WHERE "languageCode" = 'de'
  AND "partOfSpeech" = 'NOUN'
  AND gender IS NOT NULL
  AND "audioUrl" IS NOT NULL;
