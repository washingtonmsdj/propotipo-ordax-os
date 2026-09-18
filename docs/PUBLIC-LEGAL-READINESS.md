# OrdaX Public Legal Readiness

Status: NOT READY FOR LIVE ACCOUNT ACTIVATION

This document defines a technical gate around the public portal's future account activation. It does not replace legal review and it does not publish final terms or a final privacy notice.

## Current baseline

The public portal currently:

- has no live identity provider;
- does not expose a password form;
- keeps login/register targets disabled;
- has no first-party analytics or advertising runtime in `sites/public/`;
- reads only same-origin public configuration and release catalog data;
- exposes no public user account database.

The pages under `/privacidade/` and `/termos/` are therefore readiness pages, not final legal documents.

## Account activation gate

A live account entry point must remain disabled until all of the following are true:

1. a production identity provider/gateway is deployed behind the same origin;
2. a final privacy notice has been reviewed and published;
3. final terms applicable to account creation have been reviewed and published;
4. both documents have stable version identifiers and effective dates;
5. the account flow records which legal-document versions were presented/accepted where acceptance is required;
6. account deletion/export/support ownership is defined;
7. production redirects, cookies, mail templates and data processors are reviewed.

## Machine-readable state

The gate is represented by:

- `docs/contracts/public-legal-readiness.json`;
- `sites/public/config/public-site.json`;
- build validation in `tools/public-site/build.py`.

If the legal gate is not ready, setting a live login/register URL causes the public-site build to fail.

## What the readiness pages may say now

They may explain the current technical state and what still needs to be finalized. They must not claim:

- final legal terms are in force;
- consent has been collected;
- a provider is live when it is not;
- a retention period that has not been adopted;
- a controller/entity identity that has not been finalized;
- cross-border processing details that have not been reviewed.

## Future activation

When legal review is complete, replace the readiness copy with approved documents, update the stable versions/effective dates in the contract, then enable the identity routes through deployment configuration.

The gate should be changed in the same reviewed change that publishes the final documents so account activation cannot drift ahead of them.
