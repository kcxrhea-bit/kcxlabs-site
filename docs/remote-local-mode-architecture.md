# NEXUS execution modes — architecture

Design only. No relay, agent, or paid infrastructure has been built or deployed.

**Remote Local Mode is the production path.** Cloud Mode is an optional future extension that is not part of
this architecture and can never silently replace Remote Local Mode.

## 1. Execution modes and routing policy

Two different kinds of thing, kept deliberately separate.

**Execution modes** are the paths that can actually serve a request:

| | Local Mode | Remote Local Mode | Cloud Mode |
|---|---|---|---|
| Status | Available, validated | **Production path — to build** | Optional future extension |
| Client | Android on the same network | `kcxlabs.org/nexus` + Android | not implemented |
| Transport | direct to Mirror Gateway | authenticated session → relay → home PC | not implemented |
| Inference | KCxLocalAI on your PC | KCxLocalAI on your PC | hosted provider |
| Authority | your PC | your PC | external |
| Internet-accessible in v1 | no — LAN only | **yes — the only one** | no |
| If PC offline | unavailable | **unavailable — reports and stops** | n/a |

**Routing policy** is how the user configures which execution mode serves a request:

| Policy | Meaning | Status |
|---|---|---|
| `remote-local-only` | Remote access always goes to your PC. | **Current and default** |
| `hybrid` | **Hybrid Mode** — explicit user-configured routing between Remote Local and Cloud. | Future capability |

**For the first production release, Remote Local Mode is the only internet-accessible execution path.**
Local Mode remains LAN-only; Cloud Mode does not exist.

Local Mode and Remote Local Mode are the *same NEXUS instance* reached two ways. KCxLocalAI on the trusted PC
remains the sole model, project, tool, and approval authority in both. The difference is transport, not
capability or authority.

Cloud Mode is categorically different: a different model, on someone else's hardware, with no access to your
projects. That is why it is a separate capability rather than a fallback.

## 2. Hybrid Mode is a policy, not a path

Hybrid Mode is preserved as a future capability, defined precisely:

> Hybrid Mode is explicit, user-configurable routing between Remote Local Mode and Cloud Mode.

Three consequences follow, and all three are enforced rather than merely intended:

**Hybrid is never an execution mode.** It cannot be the value of an answer's `mode`. Under a hybrid policy an
answer is still stamped `remote-local` or `cloud` — the concrete path that produced it. You always know what
answered.

**Hybrid never activates Cloud Mode on failure.** This is the distinction from the rejected "Automatic Hybrid
Mode". Failure-driven fallback is rejected; user-configured routing is not. Under a hybrid policy, an
unavailable Remote Local Mode still returns unavailable — it does not silently become a cloud request. Cloud
is reached only because the user's own configuration routed there. The invariant is exported as
`hybridMayActivateCloudOnFailure = false` so a test can assert it.

**Cloud Mode stays opt-in and clearly indicated.** Selecting a hybrid policy requires Cloud Mode to exist and
an explicit opt-in. Any hosted-model answer is labelled as such.

## 3. Why failure-driven fallback is rejected

A fallback implies substitutability. These modes are not substitutable: Remote Local Mode answers *as your
NEXUS*, with your models, your approved projects, and your approval rules. A hosted model answers as
something else entirely. Silently swapping one for the other would make the system lie about what produced
an answer — which is the failure this architecture is built to prevent.

So nothing anywhere resolves a mode on the user's behalf. The user may configure routing; the system may not
infer it.

## 4. How that is enforced structurally

Policy is not enough; the shape of the system makes silent substitution unconstructible.

**Execution mode is a closed set with no automatic and no hybrid member.** `local | remote-local | cloud`.
There is deliberately no `automatic` value, so no component can resolve a mode on the user's behalf — and no
`hybrid` value, so a routing policy can never masquerade as the thing that answered.

**Mode is asserted by the producer, never inferred.** Every response carries the mode of the component that
actually produced it. The relay stamps `remote-local` because it forwarded to the agent — not because that
was requested.

**Unavailability is a terminal state, not a transition.** When the agent socket is down the relay returns a
distinct variant that carries *no answer at all*:

```
{ available: false, mode: "remote-local", reason: "trusted-pc-offline" }
```

There is no edge from this state to any other mode. The client renders unavailable and stops.

**The answer type is discriminated by mode.** An answer and its mode are one value, so a response claiming to
be an answer while carrying a different mode than the request cannot be constructed. This is a type error, not
a code review finding.

**Cloud Mode, if ever built, gets its own explicit entry point.** It is a separate user-initiated action with
its own consent surface — never a target the system falls back to. Requesting Remote Local Mode can only ever
return a Remote Local answer or an unavailable state, under every routing policy including hybrid.

## 5. Remote Local Mode topology

The defining property is that **the PC dials out**. Nothing listens on the public internet, no port is
forwarded, and no tunnel is published.

```
Browser  ──https──►  kcxlabs.org/nexus            static site + session endpoints (Vercel)
                          │  httpOnly session cookie
                          ▼
Android  ──wss───►  relay.<domain>                 relay backend (separate always-on host)
                          ▲
                          │  outbound WSS, agent-initiated, mutually authenticated
                          │
                     Remote NEXUS Agent            NEW, runs on the trusted PC
                          │  loopback HTTP
                          ▼
                     Mirror Gateway                existing, unchanged
                          │
                          ▼
                     KCxLocalAI                    existing, unchanged
```

The agent holds one persistent outbound connection. The relay owns no credentials for the PC and cannot
initiate a connection to it; it can only answer on a socket the PC already opened.

## 6. Why this shape

The gateway already refuses to be reachable publicly. `readGatewayConfig()` throws unless the bind host is an
RFC1918 or Tailscale address, so the gateway *structurally cannot* bind to a public interface. Rather than
fight that guarantee with a tunnel, the agent works with it: it connects to the gateway over the private
interface exactly as the Android app does today, and relays results outward over its own socket.

Consequences:

- No firewall change, port forward, UPnP, or public tunnel is required or permitted.
- The private gateway port and the KCxLocalAI loopback port are never reachable from the internet.
- Compromising the relay yields no shell, filesystem, or model access — only the ability to submit requests on
  the allowlisted routes below, which the gateway independently authenticates and constrains.

## 7. Three separate trust boundaries

These must not share credentials.

| Boundary | Parties | Credential | Status |
|---|---|---|---|
| Local Mode pairing | phone ↔ gateway, private network | existing device bearer token | exists, unchanged |
| Remote device pairing | phone/browser ↔ relay | new per-device remote credential | to build |
| Agent enrollment | PC agent ↔ relay | new agent credential | to build |

Local Mode keeps working independently and entirely offline — it does not depend on the relay, the session, or
the internet. Losing the relay degrades you to Local Mode; it never degrades you to a hosted model.

A remote credential is never accepted by the gateway, and a Local Mode credential is never accepted by the relay.

## 8. Credential model

**Web session.** Password login at `/nexus`, verified against a server-side Argon2id or bcrypt hash supplied
through a secret environment variable — never committed, never in `VITE_*`, never in browser code. Success
sets an httpOnly, Secure, SameSite cookie. Deliberately single-user shared-password for now, but the
per-device model below lets accounts replace it later without redesign.

**Remote device pairing**, mirroring the proven gateway flow rather than inventing one:

1. An authenticated web session at `/nexus` requests a pairing code.
2. The relay issues a short-lived single-use code (6 digits, ~5 minute TTL, attempt-capped).
3. The Android app enters or scans it.
4. The relay validates and issues a unique per-device credential, returned exactly once.
5. The relay stores only a hash, with device ID, name, creation time, last-seen time, and expiry.
6. The device sends that credential only to the relay, never to the gateway.

Revocation marks one device row revoked and terminates its sockets; other devices are unaffected. This is why
the store lives in the relay — the gateway's `GatewayStore.device` is a single nullable record, so pairing a
second device there would silently displace the first.

Rotation: credentials carry an expiry and are re-issued on reconnect past a threshold. Re-pairing after an app
reinstall is a new code producing a new device row.

**Agent enrollment.** Enrolled once from the PC with a separate credential, stored hashed by the relay,
presented on every reconnect. Not derived from and not substitutable for a device credential.

**Never leaves the PC:** the KCxLocalAI API token, the gateway admin token, and the gateway bind address.

## 9. Capability allowlist

The relay forwards only an explicit allowlist, rejecting everything else before it reaches the agent. The
gateway then authenticates and constrains again — two independent gates.

Forwardable (read-only plus chat):

- `GET /api/v1/health`, `/nexus/status`, `/connection/status`
- `GET /api/v1/projects` — opaque IDs only; paths resolve inside the gateway and never leave it
- `GET /api/v1/device/status`, `/activity`
- `POST /api/v1/chat/send`, `/chat/cancel`

Never forwardable:

- every `/api/v1/admin/*` route — loopback-only and admin-token gated at the gateway
- the Local Mode pairing routes — remote pairing is a separate boundary
- anything introduced later that writes, runs a shell, touches Git, or mutates a project

Writes and shell access are blocked by construction today because the gateway does not expose them. When they
are added, this allowlist is what keeps them PC-approved.

## 10. Rate limiting

The gateway rate-limits per remote address (60 req/min). Every remote request arrives from the agent on one
address, so all remote traffic would share one bucket. Rate limiting must be applied at the relay, per device
and per session, before forwarding.

## 11. Relay host requirements

The relay must:

- hold a **persistent inbound WebSocket** from the agent, indefinitely
- **never scale to zero or sleep** — if the host idles the socket out, Remote Local Mode goes unavailable
- support streaming responses and long-running requests
- terminate TLS on a stable hostname
- provide durable storage for device rows and audit events (SQLite on a small volume suffices)
- support per-device and per-session rate limiting and connection state
- inject secrets as environment variables

This rules out most serverless and free tiers: Vercel Functions cannot hold a long-lived socket, and hosts
that sleep on inactivity drop the agent connection.

**Recommended, lowest cost:** a single **Fly.io `shared-cpu-1x` 256 MB machine with autostop disabled**,
roughly **$2–4/month** including a small volume.

| Host | Cost | Trade-off |
|---|---|---|
| Fly.io shared-cpu-1x | ~$2–4/mo | Recommended. Must disable autostop. |
| Hetzner CX22 VPS | ~€3.79/mo | Cheapest reliable full control; you manage OS, TLS, updates. |
| Railway | ~$5/mo | Simplest deploy, slightly pricier. |
| Oracle Cloud Always Free (ARM) | $0 | Capable but free-tier capacity and reclaim policy are unreliable for a dependency. |
| Render free tier | $0 | **Unsuitable** — sleeps on inactivity, dropping the agent socket. |

Vercel keeps serving the static site and may host the light session endpoints; it does not host the relay.

## 12. Deployment contract

The relay is a container exposing one HTTPS/WSS port, configured entirely by environment variables: session
password hash, agent credential hash, allowed web origin, storage path, rate-limit settings. No secret is
baked into the image, so moving hosts is a redeploy with the same variables and the host choice stays
reversible.

## 13. Open gaps to resolve before implementation

1. **General chat has no route.** `POST /api/v1/chat/send` requires a `projectId` and returns `400
   no_project_selected` without one, so general chat has no path today. Needs either a project-less reasoning
   route or a designated general context — a gateway change in `D:\KCxProjects\KCxNexusMirror` either way.
2. **KCxNexusMirror is not under version control.** It has a passing physical-device validation and no git
   history. It should be initialised and committed before any change, since edits are otherwise unrecoverable.
3. **Single-device gateway store.** Resolved by keeping multi-device state in the relay, but the gateway still
   sees exactly one identity — the agent. Per-device attribution lives in relay audit.
4. **The browser is a second client type.** Simplest is for the authenticated session itself to be the
   credential for browser use, with device pairing reserved for Android.

## 14. Not built in this phase

No relay, no agent, no web chat client, no Android changes, no gateway changes, no infrastructure purchased or
deployed, no provider configured. This document is the design and deployment contract only.
