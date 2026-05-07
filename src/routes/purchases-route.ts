import { FastifyInstance } from 'fastify'
import { syncPurchases, syncCustomerPurchases } from '../modules/purchase-history/purchases-service.js'

export async function purchasesRoutes(app: FastifyInstance) {
    app.post('/sync/purchases', async (request) => {
        const { dryRun } = (request.body as any) ?? {}
        return syncPurchases(dryRun === true)
    })

    app.post('/sync/purchases/:customerId', async (request) => {
        const { customerId } = request.params as { customerId: string }
        const { ghlContactId } = (request.body as any) ?? {}

        if (!ghlContactId) {
            return { ok: false, error: 'ghlContactId is required in body' }
        }

        return syncCustomerPurchases(customerId, ghlContactId)
    })
}
