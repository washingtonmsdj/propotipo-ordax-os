import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify" / "github_actions_supply_chain.py"
SPEC = importlib.util.spec_from_file_location("ordax_actions_supply_chain", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
CONTRACT = json.loads(
    (ROOT / "docs" / "contracts" / "ci-supply-chain.json").read_text(encoding="utf-8")
)


class GithubActionsSupplyChainTests(unittest.TestCase):
    def seed(self, root: Path, body: str, name: str = "test.yml"):
        path = root / ".github" / "workflows" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        return path

    def base(self, uses_line: str, trigger: str = "push:", persist_credentials: str | None = "false") -> str:
        checkout_with = ""
        if uses_line.startswith("actions/checkout@") and persist_credentials is not None:
            checkout_with = (
                "        with:\n"
                f"          persist-credentials: {persist_credentials}\n"
            )
        return (
            "name: test\n"
            f"on:\n  {trigger}\n"
            "permissions:\n  contents: read\n"
            "jobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n"
            f"      - uses: {uses_line}\n"
            f"{checkout_with}"
        )

    def test_current_repository_has_no_supply_chain_violations(self):
        self.assertEqual(MODULE.find_violations(ROOT, CONTRACT), [])

    def test_mutable_action_tag_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed(root, self.base("actions/checkout@v7"))
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("full 40-hex commit SHA" in item for item in violations))

    def test_unapproved_sha_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed(root, self.base("actions/checkout@" + "a" * 40))
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("not approved" in item for item in violations))

    def test_approved_sha_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed(
                root,
                self.base("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"),
            )
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])

    def test_checkout_missing_persist_credentials_false_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed(
                root,
                self.base(
                    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                    persist_credentials=None,
                ),
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("persist-credentials: false" in item for item in violations))

    def test_checkout_persist_credentials_true_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed(
                root,
                self.base(
                    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                    persist_credentials="true",
                ),
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("persist-credentials: false" in item for item in violations))

    def test_local_repository_action_is_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed(root, self.base("./.github/actions/local"))
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])

    def test_mutable_docker_action_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed(root, self.base("docker://alpine:latest"))
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("sha256 digest" in item for item in violations))

    def test_pull_request_target_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed(
                root,
                self.base(
                    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                    trigger="pull_request_target:",
                ),
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("pull_request_target" in item for item in violations))


if __name__ == "__main__":
    unittest.main()
