import { ghlClient } from './client.js'

export async function fetchGhlAppointmentsForContact(contactId: string) {
    const res = await ghlClient.get(`/contacts/${contactId}/appointments`)
    return res.data
}