# Supabase identity adapter preparation

This folder contains provider-specific preparation for a future Supabase-backed OrdaX identity service.

It is source material only. Nothing in this folder is automatically applied to a Supabase project.

## Safety boundary

Before applying migrations to any candidate project:

1. run `preflight.sql` read-only;
2. confirm there is no unrelated custom trigger on `auth.users`;
3. confirm `public.ordax_profiles` is absent or matches this migration history;
4. confirm the project is dedicated to OrdaX identity or an isolated development environment;
5. review Auth redirect URLs and mail settings separately;
6. only then apply migrations through a tracked deployment workflow.

A project that already maps new `auth.users` rows into another product's profile model must not be reused for OrdaX identity.

## Migration 0001

`migrations/0001_ordax_profiles.sql` creates only the minimal OrdaX profile bootstrap:

- `public.ordax_profiles` keyed by `auth.users.id`;
- owner-only RLS for authenticated users;
- no anonymous table access;
- a private trigger function that creates one profile row for a new Auth user;
- a private updated-at trigger function.

It does not create plans, billing, sync objects, devices or application data. Those belong to later contracts.

## Secrets

Do not commit:

- service-role keys;
- JWT signing secrets;
- SMTP credentials;
- OAuth client secrets;
- private redirect-state keys.

Browser-facing publishable configuration, if later needed, must still enter through the public site's runtime/deployment configuration rather than a hard-coded product secret.
