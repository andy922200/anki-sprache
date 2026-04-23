-- Create per-native-language translation tables, backfill, then drop old columns.

-- 1. CardTranslation
CREATE TABLE "CardTranslation" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "nativeLanguageCode" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CardTranslation_cardId_nativeLanguageCode_key"
    ON "CardTranslation"("cardId", "nativeLanguageCode");
CREATE INDEX "CardTranslation_cardId_idx" ON "CardTranslation"("cardId");

ALTER TABLE "CardTranslation"
    ADD CONSTRAINT "CardTranslation_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "VocabularyCard"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CardTranslation"
    ADD CONSTRAINT "CardTranslation_nativeLanguageCode_fkey"
    FOREIGN KEY ("nativeLanguageCode") REFERENCES "Language"("code")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. ExampleSentenceTranslation
CREATE TABLE "ExampleSentenceTranslation" (
    "id" TEXT NOT NULL,
    "exampleId" TEXT NOT NULL,
    "nativeLanguageCode" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExampleSentenceTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExampleSentenceTranslation_exampleId_nativeLanguageCode_key"
    ON "ExampleSentenceTranslation"("exampleId", "nativeLanguageCode");
CREATE INDEX "ExampleSentenceTranslation_exampleId_idx"
    ON "ExampleSentenceTranslation"("exampleId");

ALTER TABLE "ExampleSentenceTranslation"
    ADD CONSTRAINT "ExampleSentenceTranslation_exampleId_fkey"
    FOREIGN KEY ("exampleId") REFERENCES "ExampleSentence"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExampleSentenceTranslation"
    ADD CONSTRAINT "ExampleSentenceTranslation_nativeLanguageCode_fkey"
    FOREIGN KEY ("nativeLanguageCode") REFERENCES "Language"("code")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Backfill: move existing translations into the new tables. Existing
--    dev data has no per-user provenance for native language, so mark all
--    as 'en' and let users regenerate if they want their native tongue.
INSERT INTO "CardTranslation" ("id", "cardId", "nativeLanguageCode", "translation", "createdAt")
SELECT
    gen_random_uuid()::text,
    v."id",
    'en',
    v."translation",
    v."createdAt"
FROM "VocabularyCard" v
WHERE v."translation" IS NOT NULL AND v."translation" <> '';

INSERT INTO "ExampleSentenceTranslation" ("id", "exampleId", "nativeLanguageCode", "translation", "createdAt")
SELECT
    gen_random_uuid()::text,
    e."id",
    'en',
    e."translation",
    CURRENT_TIMESTAMP
FROM "ExampleSentence" e
WHERE e."translation" IS NOT NULL AND e."translation" <> '';

-- 4. Drop old columns
ALTER TABLE "VocabularyCard" DROP COLUMN "translation";
ALTER TABLE "ExampleSentence" DROP COLUMN "translation";
