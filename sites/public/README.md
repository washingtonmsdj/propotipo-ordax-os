# Public site source

This directory owns the public OrdaX product portal. It is not the OrdaX Web product mode and it must not import the shared Surface runtime.

Routes:

- `/` — landing page;
- `/download/` — public release catalog;
- `/login/` — sign-in entry point;
- `/cadastro/` — account creation entry point.

The baseline is dependency-free HTML/CSS/JavaScript. Runtime integration is configured by `config/public-site.json` and fails closed when identity or public release services are not configured.

Do not place secrets, privileged storage URLs, private release objects or provider service-role credentials in this tree. See `docs/PUBLIC-SITE.md`.
