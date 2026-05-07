// src/integrations/patientnow/customers.ts
import { patientNowClient, withApiKeyParams } from './client.js'

export interface EnvisionCustomer {
    CustomerId: string
    CompanyId?: string
    FirstName?: string
    LastName?: string
    Email?: string
    MobilePhone?: string
    HomePhone?: string
    WorkPhone?: string
    Address1?: string
    Address2?: string
    City?: string
    State?: string
    PostalCode?: string
    CreatedOn?: string
    ModifiedOn?: string
}

export interface GetCustomersParams {
    page?: number
    rows?: number
    modifiedOnStart?: string
    modifiedOnEnd?: string
    email?: string
    mobilePhone?: string
}

export interface GetCustomersResult {
    items: EnvisionCustomer[]
    page: number
    rows: number
    totalCount?: number
}

export async function getCustomers(params: GetCustomersParams = {}): Promise<GetCustomersResult> {
    const {
        page = 1,
        rows = 100,
        modifiedOnStart,
        modifiedOnEnd,
        email,
        mobilePhone,
    } = params

    const response = await patientNowClient.get(
        '/api/v1/customers',
        withApiKeyParams({
            Page: page,
            Rows: rows,
            ModifiedOnStart: modifiedOnStart,
            ModifiedOnEnd: modifiedOnEnd,
            Email: email,
            MobilePhone: mobilePhone,
        })
    )

    const items = response.data as EnvisionCustomer[]

    return {
        items,
        page,
        rows,
    }
}