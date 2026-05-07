import { FastifyInstance } from 'fastify'
import { getCustomers } from '../integrations/patientnow/customers.js'
import { upsertGhlContact } from '../integrations/ghl/contacts.js'
import { mapEnvisionCustomerToGhlContact } from '../mapping/patientnowToGhl.js'

interface SyncContactsBody {
    startDate?: string
    endDate?: string
    page?: number
    rows?: number
    dryRun?: boolean
}

export async function registerSyncContactsRoute(app: FastifyInstance) {
    app.post<{ Body: SyncContactsBody }>('/sync/contacts', async (request, reply) => {
        const { startDate, endDate, page = 1, rows = 100, dryRun = false } =
        request.body || {}

        const result = await getCustomers({
            page,
            rows,
            modifiedOnStart: startDate,
            modifiedOnEnd: endDate,
        })

        const mapped = result.items.map(mapEnvisionCustomerToGhlContact)

        if (dryRun) {
            return reply.send({
                ok: true,
                dryRun: true,
                sourceCount: result.items.length,
                mappedPreview: mapped.slice(0, 5),
                message: 'Dry run: contacts fetched and mapped, no GHL upsert performed',
                page: result.page,
                rows: result.rows,
            })
        }

        const succeeded: { contactId?: string; firstName: string; lastName: string }[] = []
        const failed: { firstName: string; lastName: string; error: string }[] = []

        for (const contact of mapped) {
            try {
                const ghlResult = await upsertGhlContact(contact)
                succeeded.push({
                    contactId: ghlResult.contactId,
                    firstName: contact.firstName,
                    lastName: contact.lastName,
                })
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                request.log.error({ err, contact: `${contact.firstName} ${contact.lastName}` }, 'GHL upsert failed')
                failed.push({
                    firstName: contact.firstName,
                    lastName: contact.lastName,
                    error: message,
                })
            }
        }

        return reply.send({
            ok: failed.length === 0,
            sourceCount: result.items.length,
            syncedCount: succeeded.length,
            failedCount: failed.length,
            syncedPreview: succeeded.slice(0, 5),
            errors: failed.slice(0, 10),
            message:
                failed.length === 0
                    ? `All ${succeeded.length} contacts synced to GHL`
                    : `Synced ${succeeded.length}, failed ${failed.length}`,
            page: result.page,
            rows: result.rows,
        })
    })
}
