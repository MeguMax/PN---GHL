import { patientNowClient, withApiKeyParams } from '../../integrations/patientnow/client.js'
import { ghlClient } from '../../integrations/ghl/client.js'
import { env } from '../../config/env.js'
import { getSyncSince, saveSyncTimestamp } from '../../lib/sync-state.js'

export type PatientNowCustomer = {
    CustomerId: string
    CompanyId?: string
    FirstName: string
    LastName: string
    IsActive: boolean
    Address: string
    City: string
    State: string
    Zipcode: string
    HomePhone: string
    MobilePhone: string
    WorkPhone: string
    Email: string
    Birthday: string
    InitialVisit: string
    LastVisit: string
    OnlineBookingAllowed: boolean
    Unsubscribed: boolean
    Gender: string
    CardNumber: string
    LeadSourceId: string
    OptInSMSApptReminders: boolean
    OptInSMSMarketing: boolean
    OptInEmailApptReminders: boolean
    OptInEmailMarketing: boolean
    Note: string
    MobileProviderType: number
}

export async function fetchPatientNowContacts(params: Record<string, any> = {}): Promise<PatientNowCustomer[]> {
    const res = await patientNowClient.get('/api/v1/customers', withApiKeyParams(params))

    console.log('PatientNow customers raw JSON:')
    console.log(JSON.stringify(Array.isArray(res.data) ? res.data.slice(0, 3) : res.data, null, 2))

    return res.data
}

export function mapPatientNowCustomerToGhlContact(customer: PatientNowCustomer) {
    const phone =
        customer.MobilePhone ||
        customer.HomePhone ||
        customer.WorkPhone ||
        ''

    return {
        locationId: env.GHL_LOCATION_ID,
        firstName: customer.FirstName || '',
        lastName: customer.LastName || '',
        email: customer.Email || '',
        phone,
        address1: customer.Address || '',
        city: customer.City || '',
        state: customer.State || '',
        postalCode: customer.Zipcode || '',
        tags: ['patientnow'],
        customFields: [
            {
                key: 'patientnow_customer_id',
                field_value: customer.CustomerId,
            },
            {
                key: 'patientnow_company_id',
                field_value: customer.CompanyId,
            },
            {
                key: 'patientnow_last_visit',
                field_value: customer.LastVisit || '',
            },
            {
                key: 'patientnow_initial_visit',
                field_value: customer.InitialVisit || '',
            },
        ],
    }
}

export async function fetchGhlContacts() {
    const res = await ghlClient.get('/contacts/', {
        params: {
            locationId: env.GHL_LOCATION_ID,
            limit: 20,
        },
    })

    console.log('GHL contacts raw JSON:')
    console.log(JSON.stringify(res.data, null, 2))

    return res.data
}

export async function resolvePatientNowCustomerIdField() {
    const response = await ghlClient.get(`/locations/${env.GHL_LOCATION_ID}/customFields`)

    const fields = response?.data?.customFields ?? response?.data?.fields ?? response?.data ?? []

    if (!Array.isArray(fields)) return null

    return (
        fields.find(
            (field: any) =>
                field?.model === 'contact' &&
                field?.fieldKey === 'contact.patientnowcustomerid',
        ) ??
        fields.find(
            (field: any) =>
                field?.model === 'contact' &&
                String(field?.name || '').trim().toLowerCase() === 'patientnow customer id',
        ) ??
        null
    )
}

let cachedPatientNowCustomerFieldId: string | null = null

async function getPatientNowCustomerFieldId(): Promise<string | null> {
    if (cachedPatientNowCustomerFieldId) {
        return cachedPatientNowCustomerFieldId
    }

    const customField = await resolvePatientNowCustomerIdField()
    cachedPatientNowCustomerFieldId = customField?.id ?? null

    return cachedPatientNowCustomerFieldId
}

export async function extractPatientNowCustomerIdFromGhl(contact: any): Promise<string | null> {
    if (!contact?.customFields || !Array.isArray(contact.customFields)) return null

    const fieldId = await getPatientNowCustomerFieldId()
    if (!fieldId) return null

    const fieldValue = contact.customFields.find(
        (item: any) => item?.id === fieldId,
    )

    return fieldValue?.value ? String(fieldValue.value) : null
}

let cachedPatientNowCompanyId: string | null = null

export async function resolvePatientNowCompanyId(): Promise<string> {
    if (cachedPatientNowCompanyId) {
        return cachedPatientNowCompanyId
    }

    const customers = await fetchPatientNowContacts()

    if (!Array.isArray(customers) || customers.length === 0) {
        throw new Error('Unable to resolve PatientNow CompanyId: no customers returned')
    }

    const companyId = customers.find((customer) => customer?.CompanyId)?.CompanyId

    if (!companyId) {
        throw new Error('Unable to resolve PatientNow CompanyId from PatientNow customers')
    }

    cachedPatientNowCompanyId = String(companyId)

    return cachedPatientNowCompanyId
}

export async function setGhlPatientNowCustomerId(
    contactId: string,
    patientNowCustomerId: string,
) {
    const customFieldId = await getPatientNowCustomerFieldId()

    if (!customFieldId) {
        throw new Error('PatientNow Customer ID custom field was not found in GHL')
    }

    const payload = {
        customFields: [
            {
                id: customFieldId,
                value: patientNowCustomerId,
            },
        ],
    }

    console.log('GHL set custom field payload:', JSON.stringify({
        contactId,
        customFieldId,
        patientNowCustomerId,
        payload,
    }, null, 2))

    const res = await ghlClient.put(`/contacts/${contactId}`, payload)
    console.log('GHL set custom field response:', JSON.stringify(res.data, null, 2))

    const verify = await ghlClient.get(`/contacts/${contactId}`)
    console.log('GHL contact after custom field update:', JSON.stringify(verify.data, null, 2))

    return res.data
}

export async function mapGhlContactToPatientNowCustomer(contact: any): Promise<PatientNowCustomer> {
    const pnCustomerId = await extractPatientNowCustomerIdFromGhl(contact)
    const pnCompanyId = await resolvePatientNowCompanyId()

    const normalizedPhone = String(contact?.phone || '').replace(/\D+/g, '')

    return {
        CustomerId: pnCustomerId || '',
        CompanyId: pnCompanyId,
        FirstName: contact?.firstNameRaw || contact?.firstName || '',
        LastName: contact?.lastNameRaw || contact?.lastName || '',
        IsActive: true,
        Address: contact?.address1 || '',
        City: contact?.city || '',
        State: contact?.state || '',
        Zipcode: contact?.postalCode || '',
        HomePhone: normalizedPhone,
        MobilePhone: '',
        WorkPhone: '',
        Email: contact?.email || '',
        Birthday: '0001-01-01T00:00:00',
        InitialVisit: '0001-01-01T00:00:00',
        LastVisit: '0001-01-01T00:00:00',
        OnlineBookingAllowed: true,
        Unsubscribed: false,
        Gender: 'X',
        CardNumber: '',
        LeadSourceId: '',
        OptInSMSApptReminders: true,
        OptInSMSMarketing: true,
        OptInEmailApptReminders: true,
        OptInEmailMarketing: true,
        Note: '',
        MobileProviderType: 0,
    }
}

export async function upsertGhlContact(payload: ReturnType<typeof mapPatientNowCustomerToGhlContact>) {
    const res = await ghlClient.post('/contacts/upsert', payload)
    return res.data
}

export async function createPatientNowCustomer(payload: PatientNowCustomer) {

    console.log('PN CREATE payload:', JSON.stringify(payload, null, 2))

    const res = await patientNowClient.post(
        '/api/v1/customers',
        payload,
        withApiKeyParams(),
    )

    return res.data
}

export async function updatePatientNowCustomer(customerId: string, payload: PatientNowCustomer) {

    console.log('PN UPDATE payload:', JSON.stringify({ customerId, ...payload }, null, 2))

    const res = await patientNowClient.put(
        `/api/v1/customers/${customerId}`,
        payload,
        withApiKeyParams(),
    )

    return res.data
}

export async function syncContacts(dryRun = false) {
    const since = getSyncSince('contacts')
    const syncStartedAt = new Date().toISOString()

    const ghlContactsSnapshot = await fetchGhlContacts()
    console.log('GHL contacts snapshot for debug loaded:', Array.isArray(ghlContactsSnapshot?.contacts) ? ghlContactsSnapshot.contacts.length : 'unknown')

    const patientNowContacts = await fetchPatientNowContacts({
        ModifiedOnStart: since,
    })

    if (!Array.isArray(patientNowContacts) || patientNowContacts.length === 0) {
        if (!dryRun) saveSyncTimestamp('contacts', syncStartedAt)
        return {
            ok: true,
            since,
            sourceCount: 0,
            message: 'No contacts found in PatientNow',
        }
    }

    const mapped = patientNowContacts.map(mapPatientNowCustomerToGhlContact)

    if (dryRun) {
        return {
            ok: true,
            dryRun: true,
            since,
            sourceCount: patientNowContacts.length,
            mappedPreview: patientNowContacts.slice(0, 5).map((source, i) => ({
                customerId: source.CustomerId,
                firstName: source.FirstName,
                lastName: source.LastName,
                email: source.Email,
                mapped: mapped[i],
            })),
            message: 'Dry run: contacts fetched and mapped, no GHL upsert performed',
        }
    }

    const succeeded: { contactId?: string; customerId?: string; firstName: string; lastName: string }[] = []
    const failed: { customerId?: string; firstName: string; lastName: string; error: string }[] = []

    for (let i = 0; i < mapped.length; i++) {
        const contact = mapped[i]
        const source = patientNowContacts[i]

        try {
            const result = await upsertGhlContact(contact)

            console.log('GHL contact upsert result', {
                customerId: source?.CustomerId,
                email: contact.email,
                contactId: result?.contact?.id ?? result?.id,
                result,
            })

            succeeded.push({
                contactId: result?.contact?.id ?? result?.id,
                customerId: source?.CustomerId,
                firstName: contact.firstName,
                lastName: contact.lastName,
            })
        } catch (err: any) {
            const message = err?.response?.data
                ? JSON.stringify(err.response.data)
                : err?.message ?? String(err)
            failed.push({
                customerId: source?.CustomerId,
                firstName: contact.firstName,
                lastName: contact.lastName,
                error: message,
            })
        }
    }

    if (failed.length === 0 && !dryRun) {
        saveSyncTimestamp('contacts', syncStartedAt)
    }

    return {
        ok: failed.length === 0,
        since,
        sourceCount: patientNowContacts.length,
        syncedCount: succeeded.length,
        failedCount: failed.length,
        syncedPreview: succeeded.slice(0, 5),
        errors: failed.slice(0, 10),
        message:
            failed.length === 0
                ? `All ${succeeded.length} contacts synced to GHL`
                : `Synced ${succeeded.length}, failed ${failed.length}`,
    }
}

export async function syncContactsReverse(dryRun = false) {
    const ghlResponse = await fetchGhlContacts()
    const ghlContacts = Array.isArray(ghlResponse?.contacts) ? ghlResponse.contacts : []

    if (ghlContacts.length === 0) {
        return {
            ok: true,
            dryRun,
            sourceCount: 0,
            createdCount: 0,
            updatedCount: 0,
            failedCount: 0,
            message: 'No contacts found in GHL',
        }
    }

    const prepared: {
        source: any
        patientNowPayload: PatientNowCustomer
        patientNowCustomerId: string | null
    }[] = []

    for (const contact of ghlContacts) {
        const patientNowPayload = await mapGhlContactToPatientNowCustomer(contact)
        prepared.push({
            source: contact,
            patientNowPayload,
            patientNowCustomerId: patientNowPayload.CustomerId || null,
        })
    }

    console.log('SYNC CONTACTS REVERSE prepared summary:', JSON.stringify({
        total: prepared.length,
        createCount: prepared.filter((item) => !item.patientNowCustomerId).length,
        updateCount: prepared.filter((item) => !!item.patientNowCustomerId).length,
        preview: prepared.slice(0, 5).map((item) => ({
            ghlContactId: item.source?.id,
            email: item.source?.email,
            firstName: item.source?.firstName,
            lastName: item.source?.lastName,
            patientNowCustomerId: item.patientNowCustomerId,
            action: item.patientNowCustomerId ? 'update' : 'create',
        })),
    }, null, 2))

    if (dryRun) {
        return {
            ok: true,
            dryRun: true,
            sourceCount: ghlContacts.length,
            preparedPreview: prepared.slice(0, 5).map((item) => ({
                ghlContactId: item.source?.id,
                email: item.source?.email,
                firstName: item.source?.firstName,
                lastName: item.source?.lastName,
                patientNowCustomerId: item.patientNowCustomerId,
                action: item.patientNowCustomerId ? 'update' : 'create',
                payload: item.patientNowPayload,
            })),
            message: 'Dry run: GHL contacts fetched and mapped, no PatientNow write performed',
        }
    }

    const created: any[] = []
    const updated: any[] = []
    const failed: any[] = []

    for (const item of prepared) {
        try {
            if (item.patientNowCustomerId) {

                console.log('SYNC CONTACTS REVERSE action=update:', JSON.stringify({
                    ghlContactId: item.source?.id,
                    email: item.source?.email,
                    firstName: item.source?.firstName,
                    lastName: item.source?.lastName,
                    patientNowCustomerId: item.patientNowCustomerId,
                }, null, 2))

                const result = await updatePatientNowCustomer(item.patientNowCustomerId, item.patientNowPayload)

                console.log('SYNC CONTACTS REVERSE update result:', JSON.stringify({
                    ghlContactId: item.source?.id,
                    email: item.source?.email,
                    patientNowCustomerId: item.patientNowCustomerId,
                    result,
                }, null, 2))

                updated.push({
                    ghlContactId: item.source?.id,
                    patientNowCustomerId: item.patientNowCustomerId,
                    email: item.source?.email,
                    result,
                })
            } else {

                console.log('SYNC CONTACTS REVERSE action=create:', JSON.stringify({
                    ghlContactId: item.source?.id,
                    email: item.source?.email,
                    firstName: item.source?.firstName,
                    lastName: item.source?.lastName,
                }, null, 2))

                const result = await createPatientNowCustomer(item.patientNowPayload)

                const newPatientNowCustomerId =
                    result?.CustomerId ||
                    result?.customerId ||
                    result?.id ||
                    null

                console.log('SYNC CONTACTS REVERSE create result:', JSON.stringify({
                    ghlContactId: item.source?.id,
                    email: item.source?.email,
                    newPatientNowCustomerId,
                    result,
                }, null, 2))

                if (newPatientNowCustomerId && item.source?.id) {

                    console.log('SYNC CONTACTS REVERSE saving PN id to GHL:', JSON.stringify({
                        ghlContactId: item.source.id,
                        patientNowCustomerId: String(newPatientNowCustomerId),
                    }, null, 2))

                    await setGhlPatientNowCustomerId(
                        item.source.id,
                        String(newPatientNowCustomerId),
                    )
                }

                created.push({
                    ghlContactId: item.source?.id,
                    patientNowCustomerId: newPatientNowCustomerId,
                    email: item.source?.email,
                    result,
                })
            }
        } catch (err: any) {
            const message = err?.response?.data
                ? JSON.stringify(err.response.data)
                : err?.message ?? String(err)

            console.log('SYNC CONTACTS REVERSE failed:', JSON.stringify({
                ghlContactId: item.source?.id,
                email: item.source?.email,
                patientNowCustomerId: item.patientNowCustomerId,
                error: message,
            }, null, 2))

            failed.push({
                ghlContactId: item.source?.id,
                email: item.source?.email,
                patientNowCustomerId: item.patientNowCustomerId,
                error: message,
            })
        }
    }

    return {
        ok: failed.length === 0,
        sourceCount: ghlContacts.length,
        createdCount: created.length,
        updatedCount: updated.length,
        failedCount: failed.length,
        createdPreview: created.slice(0, 5),
        updatedPreview: updated.slice(0, 5),
        errors: failed.slice(0, 10),
        message:
            failed.length === 0
                ? `Processed ${ghlContacts.length} GHL contacts into PatientNow`
                : `Created ${created.length}, updated ${updated.length}, failed ${failed.length}`,
    }
}