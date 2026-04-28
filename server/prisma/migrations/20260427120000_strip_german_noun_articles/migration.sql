-- Normalize German noun lemmas: strip leading "der|die|das" article,
-- backfill the gender column from the prefix, and merge any rows that
-- collide with an already-stripped twin under
-- @@unique([languageCode, lemma, partOfSpeech]).
--
-- Idempotent: when no NOUN row matches the article-prefix pattern the
-- DO block iterates zero times, so re-running this migration is a no-op.

DO $$
DECLARE
  rec RECORD;
  loser_id TEXT;
  winner_id TEXT;
  new_lemma TEXT;
  new_gender "Gender";
BEGIN
  FOR rec IN
    SELECT id, "languageCode", lemma
    FROM "VocabularyCard"
    WHERE "partOfSpeech" = 'NOUN'
      AND lemma ~* '^(der|die|das)\s+\S'
  LOOP
    new_gender := CASE
      WHEN rec.lemma ~* '^der\s'  THEN 'DER'::"Gender"
      WHEN rec.lemma ~* '^die\s'  THEN 'DIE'::"Gender"
      WHEN rec.lemma ~* '^das\s'  THEN 'DAS'::"Gender"
    END;
    new_lemma := regexp_replace(rec.lemma, '^(der|die|das)\s+', '', 'i');

    SELECT id INTO winner_id
    FROM "VocabularyCard"
    WHERE "languageCode" = rec."languageCode"
      AND lemma = new_lemma
      AND "partOfSpeech" = 'NOUN'
      AND id <> rec.id
    LIMIT 1;

    IF winner_id IS NULL THEN
      -- No twin: just rewrite this row.
      UPDATE "VocabularyCard"
      SET lemma = new_lemma,
          gender = COALESCE(gender, new_gender)
      WHERE id = rec.id;
      CONTINUE;
    END IF;

    -- Twin exists. The article-prefixed row (rec) loses; the
    -- already-clean row (winner_id) keeps its identity. Repoint every
    -- foreign reference, dedup unique-constrained rows along the way,
    -- then drop the loser.
    loser_id := rec.id;

    -- ReviewLog references both cardId AND userCardStateId. When a user
    -- holds states for BOTH cards we must rehome their logs onto the
    -- winner's state before we delete the loser's state, otherwise the
    -- userCardStateId cascade will take history with it.
    UPDATE "ReviewLog" rl
    SET "userCardStateId" = ws.id,
        "cardId" = winner_id
    FROM "UserCardState" ls
    JOIN "UserCardState" ws ON ws."userId" = ls."userId" AND ws."cardId" = winner_id
    WHERE rl."userCardStateId" = ls.id
      AND ls."cardId" = loser_id;

    -- Drop loser-side states for users who already have a winner-side state.
    DELETE FROM "UserCardState"
    WHERE "cardId" = loser_id
      AND "userId" IN (SELECT "userId" FROM "UserCardState" WHERE "cardId" = winner_id);

    -- Repoint remaining loser-only states to the winner.
    UPDATE "UserCardState" SET "cardId" = winner_id WHERE "cardId" = loser_id;

    -- Repoint any leftover ReviewLog rows whose cardId still points at the loser
    -- (their userCardState was just transferred above).
    UPDATE "ReviewLog" SET "cardId" = winner_id WHERE "cardId" = loser_id;

    -- CardTranslation: dedup by (cardId, nativeLanguageCode) before repointing.
    DELETE FROM "CardTranslation"
    WHERE "cardId" = loser_id
      AND "nativeLanguageCode" IN (
        SELECT "nativeLanguageCode" FROM "CardTranslation" WHERE "cardId" = winner_id
      );
    UPDATE "CardTranslation" SET "cardId" = winner_id WHERE "cardId" = loser_id;

    -- ExampleSentence has no unique constraint; just repoint.
    UPDATE "ExampleSentence" SET "cardId" = winner_id WHERE "cardId" = loser_id;

    -- DailyGenerationLog.cardIds is a String[] (no FK). Replace loser id with
    -- winner id, dedup, and preserve the original presentation order via the
    -- earliest occurrence of each id.
    UPDATE "DailyGenerationLog" l
    SET "cardIds" = (
      WITH replaced AS (
        SELECT CASE WHEN c = loser_id THEN winner_id ELSE c END AS new_id, ord
        FROM unnest(l."cardIds") WITH ORDINALITY AS arr(c, ord)
      ),
      deduped AS (
        SELECT new_id, MIN(ord) AS first_ord
        FROM replaced
        GROUP BY new_id
      )
      SELECT array_agg(new_id ORDER BY first_ord) FROM deduped
    )
    WHERE loser_id = ANY(l."cardIds");

    -- Make sure the winner carries a gender (don't overwrite if already set).
    UPDATE "VocabularyCard"
    SET gender = COALESCE(gender, new_gender)
    WHERE id = winner_id;

    -- Loser is now orphan; drop it.
    DELETE FROM "VocabularyCard" WHERE id = loser_id;
  END LOOP;
END $$;
