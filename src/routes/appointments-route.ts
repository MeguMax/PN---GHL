import { FastifyInstance } from 'fastify'
import { syncAppointments, syncCustomerAppointments } from '../modules/appointments/appointments-service.js'

export async function appointmentsRoutes(app: FastifyInstance) {
    app.post('/sync/appointments', async (request) => {
        const { dryRun } = (request.body as any) ?? {}
        return syncAppointments(dryRun === true)
    })

    app.post('/sync/appointments/:customerId', async (request) => {
        const { customerId } = request.params as { customerId: string }
        const { ghlContactId } = (request.body as any) ?? {}

        if (!ghlContactId) {
            return { ok: false, error: 'ghlContactId is required in body' }
        }

        return syncCustomerAppointments(customerId, ghlContactId)
    })
}
