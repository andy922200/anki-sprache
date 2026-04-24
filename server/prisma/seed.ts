import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const LANGUAGES = [
  { code: 'de', name: 'German', nativeName: 'Deutsch', enabled: true },
  { code: 'en', name: 'English', nativeName: 'English', enabled: true },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', enabled: true },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', enabled: true },
  { code: 'zh', name: 'Chinese (Traditional)', nativeName: '繁體中文', enabled: true },
  { code: 'fr', name: 'French', nativeName: 'Français', enabled: false },
  { code: 'es', name: 'Spanish', nativeName: 'Español', enabled: false },
]

async function main() {
  const existing = await prisma.language.count()
  if (existing > 0) {
    console.log(`Language table already populated (${existing} rows), skipping seed.`)
    return
  }

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
