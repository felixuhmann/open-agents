# Self-hosted sandbox broker

Open Agents can run agent sandboxes on
[`felixuhmann/sandbox-broker`](https://github.com/felixuhmann/sandbox-broker)
instead of Daytona: hardened Docker containers on your own host, with no
third-party account and no per-sandbox ports.

Daytona remains fully supported and stays the default. A deployment that never
sets `SANDBOX_BROKER_URL` behaves exactly as it did before.

## Threat model, stated plainly

The broker isolates sandboxes with **standard Docker/runc on a shared kernel**.
That gives you filesystem, capability, socket, network, secret and resource
isolation — not a security boundary against an unknown kernel or runtime
escape. This is a **single-tenant** design: acceptable when every agent in the
deployment is one you would already trust on the same host, not acceptable as
a boundary between mutually hostile tenants. There is no VM isolation (no Kata,
no Firecracker) in v1.

The Docker socket is host root. Only the broker container receives it — never
the app, never PostgreSQL, never a sandbox.

## Enabling it

The broker lives behind a Compose profile, so it does not exist for
deployments that do not ask for it.

```bash
cp docker/.env.example docker/.env      # if you have not already

export COMPOSE_PROFILES=broker
export DOCKER_GID=$(getent group docker | cut -d: -f3)

docker compose up -d --build
```

Then set `SANDBOX_BROKER_URL=http://sandbox-broker:8080` in `docker/.env` and
restart the app, and pick **Self-hosted broker** in Setup, or in
**Settings → Sandboxes** on an existing deployment.

`DOCKER_GID` grants the broker's unprivileged user (UID 10101) access to the
socket without running as root. Forgetting it makes the broker fail to start
with a message naming the variable — it never silently starts unable to work.

## The token

By default the broker generates its own credential: on first start it writes 32
random bytes to `/home/broker/token` with mode `0600` on the shared
`broker_auth` volume, and reuses that file afterwards. The app mounts the same
volume **read-only** and reads the token from it. Nothing to generate by hand,
and the token never reaches the browser or the database.

The volume is mounted on the broker user's home directory deliberately: Docker
seeds a new named volume from the image's directory, so it inherits that
directory's `10101:10101` ownership. Mounting on a path the image does not
contain would create it root-owned, and the unprivileged broker could not write
its token there.

If you would rather supply the secret yourself — or your orchestrator cannot
guarantee the broker initializes the volume before the app reads it — set an
explicit token in `docker/.env` and it wins over the file:

```bash
SANDBOX_BROKER_TOKEN=$(openssl rand -base64 32)
```

The app re-reads the credential on each attempt until one succeeds, so an app
that starts before the broker has written the file recovers on its own without
a restart. Until then, **Settings → Sandboxes** shows the broker as unavailable
with the actual reason.

## What the topology guarantees

Verified against a running stack, not just asserted:

| Guarantee                               | How it is enforced                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Broker has no host port                 | No `ports:` on the service; `docker port` is empty                                                   |
| Broker has no public route              | No Traefik/Dokploy labels; `sandbox_control` is `internal: true`                                     |
| Only the broker holds the Docker socket | It is the sole service mounting `/var/run/docker.sock`                                               |
| Database is off the sandbox path        | `db` is only on the default network; the control network cannot resolve it                           |
| App needs no Docker access              | The app image contains no Docker CLI and mounts no socket                                            |
| Sandbox egress is separate              | The broker creates and owns `SANDBOX_BROKER_EGRESS_NETWORK`; it is never the app or database network |

## Pinning images

The defaults pin the `v0.1.0-rc.2` images by digest, so a moved tag cannot
change what runs. Override them only with another immutable digest:

```bash
SANDBOX_BROKER_IMAGE=ghcr.io/felixuhmann/sandbox-broker-server@sha256:...
SANDBOX_BROKER_SANDBOX_IMAGE=ghcr.io/felixuhmann/sandbox-broker-sandbox@sha256:...
SANDBOX_BROKER_FIREWALL_IMAGE=ghcr.io/felixuhmann/sandbox-broker-firewall@sha256:...
```

Each release publishes its digests. Readiness **fails closed** if a pinned
sandbox or firewall image is not present on the host, so a typo shows up as
"broker unavailable" in Settings rather than as a sandbox that silently runs
something else.

Set `SANDBOX_BROKER_EXPECTED_VERSION` to pin the broker build the app will
accept; a broker reporting anything else is reported unavailable instead of
being used with mismatched assumptions.

## Network policy differences from Daytona

The broker supports exactly two egress modes, and Open Agents maps the agent's
existing network policy onto them:

| Agent policy                               | Broker mode                       |
| ------------------------------------------ | --------------------------------- |
| Internet **off**                           | `deny-all` — no network at all    |
| Internet **on**, empty allow list          | `unrestricted` — public IPv4 only |
| Internet **on**, non-empty CIDR allow list | **rejected**, with remediation    |

`unrestricted` means the public IPv4 internet with private, loopback,
link-local, cloud-metadata (`169.254.169.254`), Docker gateway and every
detected host address blocked in the sandbox's own nftables rules, and IPv6
disabled. The rules are re-applied and re-verified after every start, before
the broker will accept a command.

There is deliberately **no CIDR allow list** in broker v1. An agent that has one
fails closed with

> Broker v1 does not support CIDR allowlists; clear the allowlist or select Daytona

rather than being silently widened to unrestricted egress. Internal-network
protection is always enforced under the broker, even for an agent whose stored
policy has `protectInternalNetwork: false`.

## Switching providers

One provider is active deployment-wide. Switching in Settings changes where the
**next** sandbox is created:

- existing sandbox rows stay manageable through the provider that created them;
- the next use of an existing session gets a **new, empty** workspace — files
  are not migrated between providers;
- chat history and Pi model context survive, because they live in PostgreSQL;
- runs already in flight may finish on the old provider.

Switching is refused outright if the target is unreachable, and the stored
selection is left untouched.

## Operating notes

- **Restarting the broker is safe.** It rebuilds its state from Docker labels
  and restarts any sandbox found running, because a command may have been
  executing in it and its network policy cannot be trusted until re-verified.
- **A cancelled or timed-out command recycles the sandbox container** so no
  reparented process survives. `/workspace` persists; the adapter waits out the
  restart so the next command still works.
- **Workspaces are named volumes.** They survive stop/start and are removed only
  by an explicit delete.
- **After a host firewall or interface change**, restart the broker so it
  re-probes host addresses; the block list is cached for the process lifetime.
- **Archive and recover are not supported.** Those actions are hidden for
  broker-backed sandboxes in Settings.
