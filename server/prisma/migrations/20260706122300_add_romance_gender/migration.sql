-- Extend the Gender enum for Romance languages (pt/fr/es). German continues to
-- store its article (DER/DIE/DAS) as the gender value; Portuguese and other
-- Romance nouns store grammatical gender as MASCULINE/FEMININE. Consumers map
-- (languageCode, gender) → article for display and TTS.
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op when the value already exists,
-- so re-running (e.g. after a partial deploy) is safe.

ALTER TYPE "Gender" ADD VALUE IF NOT EXISTS 'MASCULINE';
ALTER TYPE "Gender" ADD VALUE IF NOT EXISTS 'FEMININE';
