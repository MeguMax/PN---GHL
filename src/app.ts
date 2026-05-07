import Fastify from 'fastify'
import { healthRoutes } from './routes/health.js'
import { syncRoutes } from './routes/sync.js'
import { debugRoutes } from './routes/debug.js'
import { statusRoutes } from './modules/status/routes.js'

export function buildApp() {
    const app = Fastify({ logger: true })

    app.register(healthRoutes)
    app.register(syncRoutes)
    app.register(debugRoutes)
    app.register(statusRoutes)

    return app
}