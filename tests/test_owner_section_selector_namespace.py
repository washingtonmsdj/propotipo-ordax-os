from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
OWNERS = {
    "settings": ROOT / "system" / "surface" / "ui" / "settings-overview-controls.mjs",
    "account": ROOT / "system" / "surface" / "ui" / "account-overview-controls.mjs",
    "system": ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs",
}


class OwnerSectionSelectorNamespaceTests(unittest.TestCase):
    def test_container_state_is_separate_from_navigation_command_selector(self):
        for owner, path in OWNERS.items():
            with self.subTest(owner=owner):
                source = path.read_text(encoding="utf-8")
                camel = owner[0].lower() + owner[1:]
                legacy = f"slot.dataset.{camel}Section"
                active_state = f"slot.dataset.{camel}ActiveSection"
                command_state = f"button.dataset.{camel}Section = section.id"
                command_selector = f'event.target.closest("[data-{owner}-section]")'

                self.assertNotIn(
                    legacy,
                    source,
                    f"{owner} container state must not reuse the navigation command selector",
                )
                self.assertIn(active_state, source)
                self.assertIn(command_state, source)
                self.assertIn(command_selector, source)


if __name__ == "__main__":
    unittest.main()
