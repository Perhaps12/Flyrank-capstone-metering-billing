import { pool } from "../connection";

export interface Tenant {
  id: number;
  publicId: string;
  apiKey: string;
  name: string;
  createdAt: string;
}

function mapRow(row: any): Tenant {
  return {
    id: row.id,
    publicId: row.public_id,
    apiKey: row.api_key,
    name: row.name,
    createdAt: row.created_at,
  };
}

// Resolves a tenant from their api_key. Used by mockAuth middleware —
// tenant identity should always come from this, never from a client-
// supplied tenant_id in the request body.
export async function findTenantByApiKey(apiKey: string): Promise<Tenant | null> {
  const result = await pool.query(
    `SELECT id, public_id, api_key, name, created_at
     FROM tenants
     WHERE api_key = $1`,
    [apiKey]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function findTenantById(id: number): Promise<Tenant | null> {
  const result = await pool.query(
    `SELECT id, public_id, api_key, name, created_at
     FROM tenants
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// Used by seed scripts / manual tenant creation. Not exposed as a public
// signup endpoint — real signup flow is an explicit non-goal.
export async function createTenant(params: {
  name: string;
  apiKey: string;
}): Promise<Tenant> {
  const result = await pool.query(
    `INSERT INTO tenants (name, api_key)
     VALUES ($1, $2)
     RETURNING id, public_id, api_key, name, created_at`,
    [params.name, params.apiKey]
  );
  return mapRow(result.rows[0]);
}