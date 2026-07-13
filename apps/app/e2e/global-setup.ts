import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5001'

export const AUTH_STATE_PATH = path.resolve(__dirname, '.auth/state.json')

/**
 * There is no seeded login-able user (packages/database/prisma/seed.ts only
 * seeds subscription plans), so we mint a fresh tenant/owner per run via the
 * public register endpoint and persist the returned session for the authed
 * fixture to inject into sessionStorage.
 */
// Belt-and-suspenders: playwright.config.ts's webServer array already waits
// on /api/health before globalSetup runs, but re-check here too since
// globalSetup is the first thing to actually call the register endpoint.
async function waitForApi(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`)
      if (res.ok) return
    } catch {
      // API not reachable yet — keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`e2e global-setup: API did not become ready at ${API_BASE_URL} within ${timeoutMs}ms`)
}

export default async function globalSetup() {
  await waitForApi()

  const runId = Date.now()
  const payload = {
    email: `e2e-${runId}@example.com`,
    password: 'E2ePassword123!',
    firstName: 'E2E',
    lastName: 'Runner',
    clinicName: `E2E Clinic ${runId}`,
    clinicSlug: `e2e-${runId}`,
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`e2e global-setup: register failed (${response.status}): ${body}`)
  }

  const { user, accessToken, refreshToken } = await response.json()

  mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true })
  writeFileSync(
    AUTH_STATE_PATH,
    JSON.stringify({ user, accessToken, refreshToken }, null, 2)
  )
}
