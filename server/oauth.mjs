// HubSpot OAuth (authorization-code flow). Pure functions — no DB — so the
// server wires them to storage. Docs: https://developers.hubspot.com/docs/api/oauth-quickstart-guide
const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || ''
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI || ''
// Read-only scopes: automation (workflows) + deal/ticket objects (pipelines).
export const SCOPES =
  process.env.HUBSPOT_SCOPES ||
  'oauth automation crm.objects.deals.read crm.objects.tickets.read'
const API = process.env.HUBSPOT_API_BASE || 'https://api.hubapi.com'

export function oauthConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI)
}

export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  })
  return `https://app.hubspot.com/oauth/authorize?${params.toString()}`
}

async function tokenRequest(body) {
  const res = await fetch(`${API}/oauth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json.message || `HubSpot OAuth ${res.status}`)
  }
  return json // { access_token, refresh_token, expires_in }
}

export function exchangeCode(code) {
  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code,
  })
}

export function refresh(refreshToken) {
  return tokenRequest({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
  })
}

/** Portal identity for a token: hub id, domain, granted scopes. */
export async function tokenInfo(accessToken) {
  const res = await fetch(`${API}/oauth/v1/access-tokens/${accessToken}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.message || `HubSpot token info ${res.status}`)
  return {
    hubId: String(json.hub_id),
    hubDomain: json.hub_domain,
    scopes: json.scopes || [],
  }
}
