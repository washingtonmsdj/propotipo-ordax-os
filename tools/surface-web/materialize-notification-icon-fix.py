#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(path: str, old: str, new: str, expected: int = 1) -> None:
    file_path = ROOT / path
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrence(s), found {count}: {old!r}")
    file_path.write_text(text.replace(old, new), encoding="utf-8")


patch(
    "system/surface/ui/notification-center-controls.mjs",
    '''function createBellIcon(documentRef) {
  const svg = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const bell = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
  bell.setAttribute("d", "M6.5 17h11l-1.3-2v-4.2a4.2 4.2 0 0 0-8.4 0V15z");
  const clapper = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
  clapper.setAttribute("d", "M10 19a2.2 2.2 0 0 0 4 0");
  svg.append(bell, clapper);
  return svg;
}

''',
    "",
)
patch(
    "system/surface/ui/notification-center-controls.mjs",
    '''  icon.setAttribute("aria-hidden", "true");
  icon.append(createBellIcon(documentRef));
''',
    '''  icon.setAttribute("aria-hidden", "true");
  const bellShape = documentRef.createElement("span");
  bellShape.className = "ordax-notification-bell-shape";
  icon.append(bellShape);
''',
)
patch(
    "system/surface/ui/surface.css",
    '''.ordax-notification-bell svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}
''',
    '''.ordax-notification-bell-shape {
  position: relative;
  display: block;
  width: 14px;
  height: 13px;
  border: 1.7px solid currentColor;
  border-bottom: 0;
  border-radius: 8px 8px 3px 3px;
}

.ordax-notification-bell-shape::before {
  position: absolute;
  left: -3px;
  right: -3px;
  bottom: -3px;
  height: 1.7px;
  border-radius: 999px;
  background: currentColor;
  content: "";
}

.ordax-notification-bell-shape::after {
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  content: "";
  transform: translateX(-50%);
}
''',
)

print("NOTIFICATION_ICON_LOCAL_ONLY=PASS")
