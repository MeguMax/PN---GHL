import { buildApp } from './app.js'
import { env } from './config/env.js'

async function start() {
    const app = buildApp()

    try {
        await app.listen({
            port: env.PORT,
            host: '0.0.0.0',
        })
        app.log.info(`Server running on port ${env.PORT}`)
    } catch (error) {
        app.log.error(error)
        process.exit(1)
    }
}

start()