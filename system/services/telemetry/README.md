# OrdaX operational telemetry relay

This service is observability-only. It must never become a remote-control path.

The Native host reads `relay.json`, creates one anonymous persistent device id under
`/var/lib/ordax/telemetry-device-id`, and sends a bounded heartbeat to the configured
HTTPS Edge Function. The heartbeat may contain only operational runtime state such as
the checked-out SHA, update/apply state, health acknowledgement, boot id and the last
bounded rescue generation/action.

The Supabase publishable key in `relay.json` is intentionally public and is not
treated as a device secret. Database tables remain inaccessible to anon/authenticated
roles. The Edge Function validates the payload and uses its own server-side secret to
call the internal ingestion RPC.

Telemetry failure is fail-soft: it cannot prevent Surface boot, local HTTP, update
rollback, Files, Account, power actions or the independent Git rescue channel.

A second host-base telemetry agent is installed under `/state/ordax/telemetry/`.
It starts before the graphical runtime and reports a separate `:base` device row
using the same anonymous persistent device identity. That row exists specifically so
checkout/update state remains observable even when Cage, Barkery or the Native HTTP
host never reaches readiness. The base agent is observation-only and has no process,
Git-reset, power or rescue-control operations.

The updater also emits a bounded transaction context: target SHA, phase,
attempt id and last diagnostic. The relay stores the latest state in
`ordax_os.device_state` and records changes in `ordax_os.device_events`.
Heartbeat repetition does not create journal rows; only meaningful operational
transitions do. This history is observational and never authorizes an action.

Control remains separate:

- normal product/update path: Git `main`;
- bounded recovery control: Git `ordax-rescue`;
- observation only: Supabase telemetry relay.

The relay configuration is a replaceable file so the temporary Supabase project can
be migrated later without changing the telemetry contract or device identity.
