# Supabase telemetry control plane

This folder is the source-controlled owner for the OrdaX OS telemetry relay and database evolution.

The physical notebook sends bounded, observation-only telemetry through the public relay configuration in `system/services/telemetry/relay.json`. The Edge Function validates that payload and calls the SECURITY DEFINER ingest RPC. Publisher/private release keys are never part of this path.

## Production alignment

The currently connected OrdaX Supabase project predates this source-controlled folder. From this point forward, every telemetry schema or relay change must be represented here in the same change that updates the notebook agent.

`migrations/20260918_add_delivery_boot_refresh_telemetry.sql` is the first tracked delta in this folder. It has already been applied to the active OrdaX project.

`functions/ordax-os-telemetry/index.ts` is the canonical source for the deployed relay. The live relay remains custom-authenticated by the bounded public `apikey` check in the function body, so Supabase platform JWT verification is intentionally disabled for this endpoint.

## Safety boundary

- no service-role/secret key may be committed;
- the notebook gets only the Supabase publishable key;
- the Edge Function obtains its server-side secret from Supabase-managed environment variables;
- payload fields are allow-listed and bounded before the database RPC is called;
- database migrations use the `ordax_os` schema and must preserve existing device history;
- telemetry may observe power/update state but must not introduce a remote power-control path.
