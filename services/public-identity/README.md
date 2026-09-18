# OrdaX Public Identity Gateway

Status: GATEWAY CORE IMPLEMENTED / PROVIDER NOT CONFIGURED

This directory defines the backend responsibility that will sit behind the public site's login and registration entry points.

It is intentionally separate from:

- `sites/public/`, which is static presentation;
- `system/services/account/`, which owns product-side account semantics;
- any specific identity vendor.

## Intended flow

```text
sites/public/login or cadastro
 -> same-origin /auth/* entry
 -> OrdaX public identity gateway
 -> provider adapter
 -> canonical OrdaX account/session
```

The public page must not become the identity authority. The gateway owns provider handoff, callback validation, session establishment, logout and account bootstrap.

## Required routes

The gateway core in `gateway.py` now exposes this contract:

```text
GET  /auth/login
GET  /auth/register
GET  /auth/callback
POST /auth/logout
GET  /auth/session
```

The exact deployment host is deliberately not fixed here. `gateway.py` provides a dependency-free WSGI entrypoint and deliberately owns no public listener. Until a provider and same-origin deployment are configured, `/auth/login`, `/auth/register`, `/auth/callback` and `/auth/logout` fail closed with HTTP 503; `/auth/session` reports an anonymous, unauthenticated session.

The public site configuration therefore keeps login/register disabled until these routes are deployed behind the same origin. The runtime shape is pinned in `docs/contracts/public-identity-gateway.json`.

## Session policy

Production sessions must:

- use secure transport;
- prefer HttpOnly cookies so browser JavaScript does not own bearer tokens;
- use Secure cookies in production;
- use SameSite=Lax by default unless a reviewed flow requires otherwise;
- validate callback state/PKCE data;
- support revocation;
- avoid placing tokens in URLs, logs or analytics.

## Provider independence

A provider adapter may initially use Supabase Auth, but public routes and account semantics must remain OrdaX-owned.

The provider may not redefine:

- one-account-across-product-modes;
- entitlements;
- sync data classification;
- device/session revocation semantics;
- account deletion/export rules.

## Current provider decision

The previously suggested shared Supabase project was inspected read-only and is not a clean target for OrdaX identity: it already owns `auth.users` signup behavior and an unrelated `public.profiles` lifecycle.

No database, auth or Edge Function mutation was made there.

For Supabase, OrdaX identity therefore requires either a dedicated project or a development branch/project that passes the preflight in `infra/supabase/identity/preflight.sql`. Creating a paid branch/project remains a separate explicit action.

## Non-goals of this foundation

- no production identity provider is enabled;
- no password form is added to the static site;
- no publishable/service key is committed;
- no migration is applied to an existing Supabase project;
- no account is claimed to exist until the provider and gateway are live.
