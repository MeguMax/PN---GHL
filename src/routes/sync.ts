import { FastifyInstance } from 'fastify'
import {
    syncContacts,
    syncContactsReverse,
    fetchGhlContacts,
    fetchPatientNowContacts,
} from '../modules/contacts/service.js'
import { syncAppointments, syncGhlAppointmentsReverse } from '../modules/appointments/service.js'
import { syncPurchases } from '../modules/purchase-history/purchases-service.js'
import { ghlClient } from '../integrations/ghl/client.js'
import { env } from '../config/env.js'
import { fetchGhlAppointmentsForContact } from '../integrations/ghl/appointments.js'

interface SyncBody {
    dryRun?: boolean
    startDate?: string
    endDate?: string
    page?: number
    rows?: number
}

interface ContactParams {
    contactId: string
}

export async function syncRoutes(app: FastifyInstance) {
    app.post<{ Body: SyncBody }>('/sync/contacts', async (request) => {
        const { dryRun = false } = request.body || {}
        return syncContacts(dryRun)
    })

    app.post<{ Body: SyncBody }>('/sync/contacts-reverse', async (request) => {
        const { dryRun = false } = request.body || {}
        return syncContactsReverse(dryRun)
    })

    app.post<{ Body: SyncBody }>('/sync/appointments', async (request) => {
        const { dryRun = false } = request.body || {}
        return syncAppointments(dryRun)
    })

    app.post<{ Body: SyncBody }>('/sync/purchases', async (request) => {
        const { dryRun = false } = request.body || {}
        return syncPurchases(dryRun)
    })

    app.post<{ Body: SyncBody }>('/sync/ghl-appointments', async (request) => {
        const { dryRun = false } = request.body || {}
        return syncGhlAppointmentsReverse(dryRun)
    })

    app.post<{ Body: SyncBody }>('/sync/ghl-appointments-reverse', async (request) => {
        const { dryRun = false } = request.body || {}
        return syncGhlAppointmentsReverse(dryRun)
    })

    app.get('/debug/ghl-contacts', async () => {
        return fetchGhlContacts()
    })

    app.get('/debug/patientnow-contacts', async () => {
        return fetchPatientNowContacts({ Rows: 3 })
    })

    app.get('/debug/ghl-custom-fields', async (_request, reply) => {
        try {
            const response = await ghlClient.get(`/locations/${env.GHL_LOCATION_ID}/customFields`)
            return reply.send(response.data)
        } catch (error: any) {
            return reply.status(error?.response?.status || 500).send({
                message: error?.message,
                data: error?.response?.data ?? null,
            })
        }
    })

    app.get<{ Params: ContactParams }>(
        '/debug/ghl-contact-appointments/:contactId',
        async (request, reply) => {
            try {
                const data = await fetchGhlAppointmentsForContact(request.params.contactId)
                return reply.send(data)
            } catch (error: any) {
                return reply.status(error?.response?.status || 500).send({
                    message: error?.message,
                    data: error?.response?.data ?? null,
                })
            }
        },
    )
}