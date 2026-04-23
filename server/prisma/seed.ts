import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const LANGUAGES = [
  { code: 'de', name: 'German', nativeName: 'Deutsch', enabled: true },
  { code: 'en', name: 'English', nativeName: 'English', enabled: true },
  { code: 'fr', name: 'French', nativeName: 'Français', enabled: false },
  { code: 'es', name: 'Spanish', nativeName: 'Español', enabled: false },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', enabled: false },
  { code: 'zh', name: 'Chinese (Traditional)', nativeName: '繁體中文', enabled: false },
]

async function main() {
  for (const lang of LANGUAGES) {
    await prisma.language.upsert({
      where: { code: lang.code },
      update: { name: lang.name, nativeName: lang.nativeName, enabled: lang.enabled },
      create: lang,
    })
  }
  console.log(`Seeded ${LANGUAGES.length} languages`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
