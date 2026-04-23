-- CreateEnum
CREATE TYPE "UiLanguage" AS ENUM ('EN', 'ZH_TW');

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "uiLanguage" "UiLanguage" NOT NULL DEFAULT 'EN';
