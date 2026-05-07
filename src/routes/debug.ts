import { FastifyInstance } from 'fastify'
import { patientNowClient, withApiKeyParams } from '../integrations/patientnow/client.js'

async function tryGet(path: string) {
    try {
        const res = await patientNowClient.get(path, withApiKeyParams())

        return {
            path,
            ok: true,
            status: res.status,
            isArray: Array.isArray(res.data),
            count: Array.isArray(res.data) ? res.data.length : undefined,
            dataPreview: Array.isArray(res.data) ? res.data.slice(0, 2) : res.data,
        }
    } catch (error: any) {
        return {
            path,
            ok: false,
            status: error?.response?.status ?? 500,
            data: error?.response?.data ?? null,
            message: error?.message ?? 'Unknown error',
        }
    }
}

export async function debugRoutes(app: FastifyInstance) {
    app.get('/debug/patientnow', async () => {
        return tryGet('/api/v1/employeedepartments')
    })

    app.get('/debug/patientnow/contacts', async () => {
        const candidates = [
            '/api/v1/clients',
            '/api/v1/patients',
            '/api/v1/contacts',
            '/api/v1/client',
            '/api/v1/patient',
        ]

        const results = []
        for (const path of candidates) {
            results.push(await tryGet(path))
        }

        return { ok: true, results }
    })

    app.get('/debug/patientnow/appointments', async () => {
        const candidates = [
            '/api/v1/appointments',
            '/api/v1/appointment',
            '/api/v1/calendarappointments',
            '/api/v1/calendars',
            '/api/v1/scheduledappointments',
        ]

        const results = []
        for (const path of candidates) {
            results.push(await tryGet(path))
        }

        return { ok: true, results }
    })

    app.get('/debug/patientnow/purchases', async () => {
        const candidates = [
            '/api/v1/tickethistory',
            '/api/v1/tickets',
            '/api/v1/purchases',
            '/api/v1/purchasehistory',
            '/api/v1/transactions',
        ]

        const results = []
        for (const path of candidates) {
            results.push(await tryGet(path))
        }

        return { ok: true, results }
    })
    app.get('/debug/patientnow/appointments-range', async () => {
        try {
            const res = await patientNowClient.get(
                '/api/v1/appointments',
                withApiKeyParams({
                    startDate: '2025-01-01',
                    endDate: '2026-12-31',
                }),
            )

            return {
                ok: true,
                status: res.status,
                isArray: Array.isArray(res.data),
                count: Array.isArray(res.data) ? res.data.length : undefined,
                dataPreview: Array.isArray(res.data) ? res.data.slice(0, 3) : res.data,
            }
        } catch (error: any) {
            return {
                ok: false,
                status: error?.response?.status ?? 500,
                data: error?.response?.data ?? null,
                message: error?.message ?? 'Unknown error',
            }
        }
    })
    app.get('/debug/patientnow/discovery', async () => {
        const candidates = [
            '/api/v1/customers',
            '/api/v1/customer',
            '/api/v1/persons',
            '/api/v1/person',
            '/api/v1/patientsummary',
            '/api/v1/clientprofile',
            '/api/v1/clientprofiles',
            '/api/v1/patientprofile',
            '/api/v1/patientprofiles',
            '/api/v1/ticketsales',
            '/api/v1/ticketitems',
            '/api/v1/invoices',
            '/api/v1/sales',
            '/api/v1/transactionshistory',
            '/api/v1/ledger',
        ]

        const results = []

        for (const path of candidates) {
            try {
                const res = await patientNowClient.get(path, withApiKeyParams())
                results.push({
                    path,
                    ok: true,
                    status: res.status,
                    isArray: Array.isArray(res.data),
                    count: Array.isArray(res.data) ? res.data.length : undefined,
                    dataPreview: Array.isArray(res.data) ? res.data.slice(0, 1) : res.data,
                })
            } catch (error: any) {
                results.push({
                    path,
                    ok: false,
                    status: error?.response?.status ?? 500,
                    data: error?.response?.data ?? null,
                })
            }
        }

        return { ok: true, results }
    })
    app.get('/debug/patientnow/raw', async (request, reply) => {
        const { path: apiPath, ...params } = request.query as Record<string, string>
        if (!apiPath) return reply.status(400).send({ error: 'path query param required' })
        try {
            const res = await patientNowClient.get(apiPath, withApiKeyParams(params))
            return reply.send({ ok: true, status: res.status, data: res.data })
        } catch (err: any) {
            return reply.send({
                ok: false,
                status: err?.response?.status,
                data: err?.response?.data,
                message: err?.message,
            })
        }
    })

    app.post('/debug/patientnow/raw', async (request, reply) => {
        const { path: apiPath } = request.query as Record<string, string>
        if (!apiPath) return reply.status(400).send({ error: 'path query param required' })
        try {
            const res = await patientNowClient.post(
                apiPath,
                request.body ?? {},
                withApiKeyParams(),
            )
            return reply.send({ ok: true, status: res.status, data: res.data })
        } catch (err: any) {
            return reply.send({
                ok: false,
                status: err?.response?.status,
                data: err?.response?.data,
                message: err?.message,
            })
        }
    })
}

