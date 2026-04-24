-- Add Portuguese and reconcile `enabled` flags for the supported language set.
-- Supported (enabled=true): en, de, ja, pt, zh
-- Kept but disabled:         fr, es

INSERT INTO "Language" ("code", "name", "nativeName", "enabled")
VALUES ('pt', 'Portuguese', 'Português', true)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "nativeName" = EXCLUDED."nativeName",
    "enabled" = EXCLUDED."enabled";

UPDATE "Language" SET "enabled" = true WHERE "code" IN ('en', 'de', 'ja', 'zh');
UPDATE "Language" SET "enabled" = false WHERE "code" IN ('fr', 'es');
