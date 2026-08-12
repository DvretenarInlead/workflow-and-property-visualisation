// Postgres access for portal mode. Portals hold an encrypted HubSpot OAuth token;
// cached datasets are stored per portal as JSONB. Everything is gated on
// DATABASE_URL being set — without it the app runs in standalone mode.
import pg from 'pg'
import { encrypt, decrypt } from './crypto.mjs'

const DATABASE_URL = process.env.DATABASE_URL || ''

let pool = null

export function dbConfigured() {
  return Boolean(DATABASE_URL)
}

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      // Managed Postgres (incl. DO) generally requires TLS; allow self-signed chains.
      ssl: DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
      max: 5,
    })
  }
  return pool
}

/** Create tables if they don't exist. Called once at boot when DB is configured. */
export async function initSchema() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS portals (
      id            TEXT PRIMARY KEY,
      hub_id        TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      token_enc     TEXT NOT NULL,
      refresh_enc   TEXT NOT NULL,
      expires_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_synced   TIMESTAMPTZ,
      data          JSONB
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state       TEXT PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  // Best-effort cleanup of stale OAuth states (older than 15 min).
  await getPool()
    .query(`DELETE FROM oauth_states WHERE created_at < now() - interval '15 minutes'`)
    .catch(() => {})
}

// --- OAuth state (CSRF protection for the login redirect) ---
export async function saveOAuthState(state) {
  await getPool().query('INSERT INTO oauth_states(state) VALUES ($1) ON CONFLICT DO NOTHING', [state])
}
export async function consumeOAuthState(state) {
  const res = await getPool().query('DELETE FROM oauth_states WHERE state = $1 RETURNING state', [state])
  return res.rowCount > 0
}

// --- Portals ---
export async function upsertPortal({ id, hubId, name, token, refreshToken, expiresAt }) {
  await getPool().query(
    `INSERT INTO portals(id, hub_id, name, token_enc, refresh_enc, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (hub_id) DO UPDATE SET
       name = EXCLUDED.name,
       token_enc = EXCLUDED.token_enc,
       refresh_enc = EXCLUDED.refresh_enc,
       expires_at = EXCLUDED.expires_at`,
    [id, hubId, name, encrypt(token), encrypt(refreshToken), expiresAt],
  )
}

export async function listPortals() {
  const res = await getPool().query(
    'SELECT id, hub_id, name, created_at, last_synced FROM portals ORDER BY name',
  )
  return res.rows.map((r) => ({
    id: r.id,
    hubId: r.hub_id,
    name: r.name,
    createdAt: r.created_at,
    lastSynced: r.last_synced,
  }))
}

/** Full portal record including decrypted tokens (server-side only). */
export async function getPortalSecret(id) {
  const res = await getPool().query('SELECT * FROM portals WHERE id = $1', [id])
  if (!res.rowCount) return null
  const r = res.rows[0]
  return {
    id: r.id,
    hubId: r.hub_id,
    name: r.name,
    token: decrypt(r.token_enc),
    refreshToken: decrypt(r.refresh_enc),
    expiresAt: r.expires_at,
  }
}

export async function updatePortalTokens(id, { token, refreshToken, expiresAt }) {
  await getPool().query(
    'UPDATE portals SET token_enc=$2, refresh_enc=$3, expires_at=$4 WHERE id=$1',
    [id, encrypt(token), encrypt(refreshToken), expiresAt],
  )
}

export async function savePortalData(id, data) {
  await getPool().query('UPDATE portals SET data=$2, last_synced=now() WHERE id=$1', [id, data])
}

export async function getPortalData(id) {
  const res = await getPool().query('SELECT data FROM portals WHERE id=$1', [id])
  return res.rowCount ? res.rows[0].data : null
}
