import { buildApp } from './app.js'
import { env } from './config/env.js'

async function main() {
  const app = await buildApp()
  try {
    await app.listen({ port: env.PORT, host: env.HOST })
    app.log.info(`Server listening on http://${env.HOST}:${env.PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      app.log.info(`Received ${sig}, shutting down`)
      await app.close()
      process.exit(0)
    })
  }
}

main().catch((err) => {
  console.error('Failed to start server', err)
  process.exit(1)
})
