import { env } from '../../config/env.js'

export interface GhlCustomField {
    key: string
    field_value: string
}

export interface GhlMappedContact {
    firstName: string
    lastName: string
    email?: string
    phone?: string
    address1?: string
    city?: string
    state?: string
    postalCode?: string
    tags?: string[]
    customFields?: GhlCustomField[]
}

export interface UpsertGhlContactResult {
    success: boolean
    contactId?: string
    raw: unknown
}

export async function upsertGhlContact(
    contact: GhlMappedContact,
): Promise<UpsertGhlContactResult> {
    const payload = {
        locationId: env.GHL_LOCATION_ID,
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        ...(contact.email && { email: contact.email }),
        ...(contact.phone && { phone: contact.phone }),
        ...(contact.address1 && { address1: contact.address1 }),
        ...(contact.city && { city: contact.city }),
        ...(contact.state && { state: contact.state }),
        ...(contact.postalCode && { postalCode: contact.postalCode }),
        tags: contact.tags ?? [],
        customFields: (contact.customFields ?? [])
            .filter(f => f.key && f.field_value !== undefined && f.field_value !== '')
            .map(f => ({ key: f.key, field_value: String(f.field_value) })),
    }

    const response = await fetch(`${env.GHL_BASE_URL}/contacts/upsert`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.GHL_API_TOKEN}`,
            Version: env.GHL_API_VERSION,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify(payload),
    })

    const rawText = await response.text()
    let raw: unknown = rawText
    try {
        raw = rawText ? JSON.parse(rawText) : null
    } catch {
        raw = rawText
    }

    if (!response.ok) {
        throw new Error(
            `GHL upsert failed [${response.status}]: ${rawText}`,
        )
    }

    const contactId =
        raw && typeof raw === 'object'
            ? ((raw as any).contact?.id ?? (raw as any).id ?? undefined)
            : undefined

    return { success: true, contactId, raw }
}
