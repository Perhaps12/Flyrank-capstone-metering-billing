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

// Resolves a tenant from their api_key. Used by mockAuth middleware to simulate a JVM auth flow.
// In this project we hardcode tenants and api_keys but in real production you would use the temporary keys generated during auth
// tenantID is never supplied directly in the request body; this is the only way to resolve a tenant.
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