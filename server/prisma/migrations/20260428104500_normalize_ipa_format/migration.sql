-- Normalize VocabularyCard.ipa to phonemic form /…/.
-- Strips any combination of leading/trailing slashes, brackets, and whitespace,
-- then re-wraps in /…/. Idempotent: rerunning the migration is a no-op.

UPDATE "VocabularyCard"
SET ipa = '/' || trim(both '/[] ' from ipa) || '/'
WHERE ipa IS NOT NULL
  AND trim(both '/[] ' from ipa) <> '';

-- Anything that was empty / pure-wrapper (e.g. '', '[]', '//') becomes NULL.
UPDATE "VocabularyCard" SET ipa = NULL WHERE ipa = '//';
