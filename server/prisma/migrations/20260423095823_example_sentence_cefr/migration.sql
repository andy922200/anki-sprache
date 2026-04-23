-- AlterTable
ALTER TABLE "ExampleSentence" ADD COLUMN     "cefrLevel" "CEFR" NOT NULL DEFAULT 'A1';

-- CreateIndex
CREATE INDEX "ExampleSentence_cardId_cefrLevel_idx" ON "ExampleSentence"("cardId", "cefrLevel");
