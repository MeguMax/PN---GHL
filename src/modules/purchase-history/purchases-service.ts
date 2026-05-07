// purchases-services.ts (файл, где syncPurchases)
import { patientNowClient, withApiKeyParams } from '../../integrations/patientnow/client.js'
import { ghlClient } from '../../integrations/ghl/client.js'
import { env } from '../../config/env.js'
import { fetchPatientNowContacts } from '../contacts/service.js'
import fs from 'fs'
import path from 'path'
import { getSyncSince, saveSyncTimestamp } from '../../lib/sync-state.js'

// Types

export type OrderLineItem = {
    ItemId?: string
    ItemName?: string
    Qty?: number
    RetailPrice?: number
    ExtendedPrice?: number
}

export type OrderPayment = {
    PaymentType?: string
    Amount?: number
    PaymentDate?: string
}

export type PatientNowOrder = {
    OrderId: string
    CustomerId?: string
    CompanyId?: string
    OrderDate?: string
    OrderNumber?: string
    SubTotal?: number
    Total?: number
    TotalTax?: number
    TotalDiscount?: number
    LineItems?: OrderLineItem[]
    Payments?: OrderPayment[]
}

// Sync history

const HISTORY_FILE = path.resolve('data/purchases-sync-history.json')

function loadHistory(): Record<string, string> {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
        }
    } catch {}
    return {}
}

function saveHistory(history: Record<string, string>) {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true })
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
}

// PatientNow fetchers

export async function fetchAllOrders(params: Record<string, any> = {}): Promise<PatientNowOrder[]> {
    const res = await patientNowClient.get('/api/v1/orders', withApiKeyParams(params))
    return Array.isArray(res.data) ? res.data : []
}

export async function fetchCustomerPurchases(
    customerId: string,
    params: Record<string, any> = {},
): Promise<PatientNowOrder[]> {
    const res = await patientNowClient.post(
        `/api/v1/customers/${customerId}/Purchases`,
        {},
        withApiKeyParams(params),
    )
    return Array.isArray(res.data) ? res.data : []
}

// GHL helpers

async function findGhlContactByCustomerId(customerId: string, email?: string): Promise<string | null> {
    if (!customerId && !email) return null

    try {
        const res = await ghlClient.get('/contacts/', {
            params: {
                locationId: env.GHL_LOCATION_ID,
                limit: 100,
                query: customerId || email || '',
            },
        })

        const contacts = res.data?.contacts ?? []

        const exactByCustomerId = contacts.find((c: any) =>
            c.customFields?.some(
                (f: any) =>
                    f.key === 'patientnow_customer_id' &&
                    String(f.value ?? f.field_value ?? '') === String(customerId),
            ),
        )

        if (exactByCustomerId?.id) return exactByCustomerId.id

        if (email) {
            const exactByEmail = contacts.find(
                (c: any) => String(c.email ?? '').toLowerCase() === String(email).toLowerCase(),
            )
            if (exactByEmail?.id) return exactByEmail.id
        }

        return null
    } catch {
        return null
    }
}

async function createGhlNote(contactId: string, body: string): Promise<string | null> {
    try {
        const res = await ghlClient.post(`/contacts/${contactId}/notes`, {
            userId: contactId,
            body,
        })
        return res.data?.note?.id ?? res.data?.id ?? null
    } catch {
        return null
    }
}

// Formatters

function formatOrderNote(order: PatientNowOrder): string {
    const date = order.OrderDate
        ? new Date(order.OrderDate).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
          })
        : 'Unknown date'

    const total = order.Total != null ? `$${order.Total.toFixed(2)}` : 'N/A'
    const lines: string[] = [`[Purchase] Order #${order.OrderNumber ?? order.OrderId} — ${date}`]

    if (order.Total != null) lines.push(`Total: ${total}`)
    if (order.TotalTax != null && order.TotalTax > 0) lines.push(`Tax: $${order.TotalTax.toFixed(2)}`)
    if (order.TotalDiscount != null && order.TotalDiscount > 0)
        lines.push(`Discount: -$${order.TotalDiscount.toFixed(2)}`)

    if (order.LineItems && order.LineItems.length > 0) {
        lines.push('')
        lines.push('Items:')
        for (const item of order.LineItems) {
            const qty = item.Qty ?? 1
            const price = item.ExtendedPrice != null ? ` — $${item.ExtendedPrice.toFixed(2)}` : ''
            lines.push(`  • ${item.ItemName ?? item.ItemId ?? 'Unknown item'} x${qty}${price}`)
        }
    }

    if (order.Payments && order.Payments.length > 0) {
        lines.push('')
        lines.push('Payments:')
        for (const payment of order.Payments) {
            const amount = payment.Amount != null ? `$${payment.Amount.toFixed(2)}` : 'N/A'
            const type = payment.PaymentType ?? 'Unknown'
            lines.push(`  • ${type}: ${amount}`)
        }
    }

    lines.push('')
    lines.push(`PatientNow OrderId: ${order.OrderId}`)
    if (order.CustomerId) lines.push(`PatientNow CustomerId: ${order.CustomerId}`)

    return lines.join('\n')
}

// Main sync

export async function syncPurchases(dryRun = false) {
    const since = getSyncSince('purchases')
    const syncStartedAt = new Date().toISOString()

    const orders = await fetchAllOrders({
        // PatientNow для orders, судя по паттерну, тоже понимает ModifiedOnStart
        // если нет — оставь только StartDate/EndDate
        ModifiedOnStart: since,
        StartDate: '2020-01-01',
        EndDate: '2030-12-31',
    })

    if (!Array.isArray(orders) || orders.length === 0) {
        if (!dryRun) saveSyncTimestamp('purchases', syncStartedAt)
        return {
            ok: true,
            since,
            sourceCount: 0,
            message: 'No orders found in PatientNow',
        }
    }

    if (dryRun) {
        return {
            ok: true,
            dryRun: true,
            since,
            sourceCount: orders.length,
            dataPreview: orders.slice(0, 3),
            message: `Dry run: ${orders.length} orders found, no GHL notes created`,
        }
    }

    const customers = await fetchPatientNowContacts()
    const customerEmailMap = new Map(
        customers.map((c: any) => [c.CustomerId, c.Email]),
    )

    const history = loadHistory()

    const succeeded: { orderId: string; ghlNoteId?: string; skipped?: boolean }[] = []
    const failed: { orderId: string; error: string }[] = []

    for (const order of orders) {
        try {
            if (history[order.OrderId]) {
                succeeded.push({
                    orderId: order.OrderId,
                    ghlNoteId: history[order.OrderId],
                    skipped: true,
                })
                continue
            }

            const email = customerEmailMap.get(order.CustomerId ?? '')
            const contactId = await findGhlContactByCustomerId(order.CustomerId ?? '', email ?? '')

            if (!contactId) {
                failed.push({
                    orderId: order.OrderId,
                    error: `No GHL contact found for CustomerId: ${order.CustomerId} (email: ${email ?? 'unknown'})`,
                })
                continue
            }

            const noteBody = formatOrderNote(order)
            const ghlNoteId = await createGhlNote(contactId, noteBody)

            if (!ghlNoteId) {
                failed.push({
                    orderId: order.OrderId,
                    error: 'GHL note creation returned no ID',
                })
                continue
            }

            history[order.OrderId] = ghlNoteId
            succeeded.push({ orderId: order.OrderId, ghlNoteId })
        } catch (err: any) {
            const message = err?.response?.data
                ? JSON.stringify(err.response.data)
                : err?.message ?? String(err)

            failed.push({ orderId: order.OrderId, error: message })
        }
    }

    saveHistory(history)

    if (failed.length === 0 && !dryRun) {
        saveSyncTimestamp('purchases', syncStartedAt)
    }

    const created = succeeded.filter(x => !x.skipped).length
    const skipped = succeeded.filter(x => x.skipped).length

    return {
        ok: failed.length === 0,
        since,
        sourceCount: orders.length,
        createdCount: created,
        skippedCount: skipped,
        failedCount: failed.length,
        syncedPreview: succeeded.slice(0, 5),
        errors: failed.slice(0, 10),
        message:
            failed.length === 0
                ? `All ${orders.length} processed: ${created} notes created, ${skipped} already existed`
                : `Created ${created}, skipped ${skipped}, failed ${failed.length}`,
    }
}

// Single customer purchases sync

export async function syncCustomerPurchases(customerId: string, ghlContactId: string) {
    const orders = await fetchCustomerPurchases(customerId)

    if (!orders.length) {
        return { ok: true, sourceCount: 0, message: 'No purchases for this customer' }
    }

    const history = loadHistory()
    const results: { orderId: string; ghlNoteId?: string; skipped?: boolean; error?: string }[] = []

    for (const order of orders) {
        if (history[order.OrderId]) {
            results.push({ orderId: order.OrderId, ghlNoteId: history[order.OrderId], skipped: true })
            continue
        }

        const noteBody = formatOrderNote(order)
        const ghlNoteId = await createGhlNote(ghlContactId, noteBody)

        if (ghlNoteId) {
            history[order.OrderId] = ghlNoteId
            results.push({ orderId: order.OrderId, ghlNoteId })
        } else {
            results.push({ orderId: order.OrderId, error: 'GHL note creation failed' })
        }
    }

    saveHistory(history)

    return {
        ok: true,
        sourceCount: orders.length,
        results,
    }
}
