const WEB_PROTOCOLS = new Set(["http:", "https:"]);

export function parseNotesWebHref(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!WEB_PROTOCOLS.has(parsed.protocol)) return null;
    return Object.freeze({
      href: parsed.href,
      host: parsed.hostname || parsed.host || parsed.href,
    });
  } catch {
    return null;
  }
}

export function notesWebReferenceHost(value) {
  const parsed = parseNotesWebHref(value);
  return parsed?.host ?? String(value ?? "");
}

export function createNotesLinkReference(value, title = "") {
  const parsed = parseNotesWebHref(value);
  if (!parsed) {
    throw new TypeError("Notes web reference must use http or https");
  }
  const normalizedTitle = String(title ?? "").trim() || parsed.host;
  return Object.freeze({
    kind: "link",
    title: normalizedTitle,
    detail: "Link",
    href: parsed.href,
  });
}
