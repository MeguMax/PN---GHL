import type { FastifyInstance } from 'fastify'
import { getSyncStatus } from './service.js'

export async function statusRoutes(fastify: FastifyInstance) {
    fastify.get('/status', async () => {
        return getSyncStatus()
    })
}