# Files domain services

**Owner:** first-party **Arquivos** application / local work context.

This module owns shared, platform-neutral policy for file-oriented context that is not filesystem I/O itself. The first service is the bounded local **Recentes** index.

Boundaries:

- filesystem reads and mutations remain behind `ordax.file-space/*` adapters;
- persistence mechanics remain behind `ordax.recent-files-store/1` adapters;
- the recent index stores only authorized logical paths, display names derived from those paths, and local access timestamps;
- absolute host paths, file contents, credentials and grants are never stored here;
- recent history is local context and is not account sync data;
- clearing or removing history never deletes a user file;
- policy belongs here once; platform adapters do not fork retention or ordering semantics.
