// Shared listening server for the route tests.
//
// `request(app)` makes supertest bind a fresh ephemeral server per request and
// close it again once the response lands (supertest/lib/test.js: `serverAddress`
// only calls `app.listen(0)` when `app.address()` is null, and `end()` only
// closes the server when it created it). That was ~6,250 listen/connect/close
// cycles per suite run, and it is where the suite's intermittent
// "Parse Error: Expected HTTP/, RTSP/ or ICE/" and 30s hangs came from:
//
//   1. `app.listen(0)` binds the WILDCARD address. Node always sets
//      SO_REUSEADDR, and on BSD/macOS that lets a wildcard bind succeed on a
//      port another process already holds on 127.0.0.1 specifically.
//   2. supertest then connects to the hardcoded `http://127.0.0.1:<port>`.
//   3. The more specific 127.0.0.1 bind wins the demux, so the request is
//      served by that other process instead of by the app.
//
// On this project's dev machines the squatters are Colima/Lima's SSH forwarder
// (its banner "SSH-2.0-OpenSSH_9.6p1 ..." is exactly what the HTTP client
// parser rejected) plus assorted always-on agents that accept and never answer,
// which is the 30s-timeout half of the symptom. CI never saw it because
// ubuntu-latest has no such loopback listeners.
//
// The fix is two-part, and both parts are load-bearing:
//   * bind ONCE per module registry instead of once per request, and
//   * bind to 127.0.0.1 explicitly, so the kernel's ephemeral allocator refuses
//     any port already held on loopback (a loopback-specific bind on a squatted
//     port returns EADDRINUSE, where the wildcard bind silently succeeds).
//
// The bind is awaited at module scope because `listen(port, host)` resolves the
// host through dns.lookup and therefore populates `address()` asynchronously.
// Handing supertest a server whose `address()` is still null would make it bind
// a second, wildcard server behind our back and reintroduce the bug.
//
// `src/routes/health.test.ts` deliberately keeps `request(app)`: it `vi.mock`s
// @dental/database and imports ../app.js dynamically, so eagerly importing the
// app here would defeat that mock.

import { once } from 'node:events'
import request from 'supertest'
import { app } from '../app.js'

const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
// Don't let the shared server keep the vitest worker alive after the run.
server.unref()

export const api = (): request.Agent => request(server)
