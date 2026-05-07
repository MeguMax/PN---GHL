import type { EnvisionCustomer } from '../integrations/patientnow/customers.js'
import type { GhlMappedContact } from '../integrations/ghl/contacts.js'

export function mapEnvisionCustomerToGhlContact(
    customer: EnvisionCustomer,
): GhlMappedContact {
    return {
        firstName: customer.FirstName || '',
        lastName: customer.LastName || '',
        email: customer.Email || '',
        phone: customer.MobilePhone || customer.HomePhone || customer.WorkPhone || '',
        address1: customer.Address1 || '',
        city: customer.City || '',
        state: customer.State || '',
        postalCode: customer.PostalCode || '',
        tags: ['patientnow'],
        customFields: [
            {
                key: 'patientnow_customer_id',
                field_value: customer.CustomerId || '',
            },
            {
                key: 'patientnow_company_id',
                field_value: customer.CompanyId || '',
            },
            {
                key: 'patientnow_last_modified',
                field_value: customer.ModifiedOn || '',
            },
            {
                key: 'patientnow_created_on',
                field_value: customer.CreatedOn || '',
            },
        ],
    }
}
