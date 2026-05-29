import { buildApp } from './app.js'
import { env } from './config/env.js'
import { startSyncRunner, stopSyncRunner } from './jobs/runner.js'

async function start() {
    const app = buildApp()

    const shutdown = async (signal: string) => {
        app.log.info(`Received ${signal}, shutting down...`)
        stopSyncRunner()

        try {
            await app.close()
            process.exit(0)
        } catch (error) {
            app.log.error(error)
            process.exit(1)
        }
    }

    process.on('SIGINT', () => void shutdown('SIGINT'))
    process.on('SIGTERM', () => void shutdown('SIGTERM'))

    try {
        await app.listen({
            port: env.PORT,
            host: '0.0.0.0',
        })

        app.log.info(`Server running on port ${env.PORT}`)

        void startSyncRunner()
    } catch (error) {
        app.log.error(error)
        process.exit(1)
    }
}

start()