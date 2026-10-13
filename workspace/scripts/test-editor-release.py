"""Release identity regression tests (no GitHub credentials required)."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("editor_release", Path(__file__).with_name("editor-release.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReleaseMetadataTests(unittest.TestCase):
    def resolve(self, **overrides):
        args = dict(version="0.9.1", event="workflow_dispatch", preview=False,
                    requested_tag="", ref_name="feat/click-to-move", sha="a" * 40,
                    run_id="123", attempt="1")
        args.update(overrides)
        return module.metadata(**args)

    def test_stable_default_and_tag_event(self):
        self.assertEqual(self.resolve()["tag"], "v0.9.1")
        self.assertEqual(self.resolve(event="push", ref_name="v0.9.1")["version"], "0.9.1")

    def test_stable_rejects_wrong_version_and_preview_tag(self):
        for tag in ("v0.8.0", "editor-preview-123", "v0.9.1; echo unsafe"):
            with self.assertRaises(ValueError):
                self.resolve(requested_tag=tag)

    def test_preview_identity_and_unique_attempt(self):
        result = self.resolve(preview=True)
        self.assertEqual(result["version"], "0.9.1-preview.123.1.gaaaaaaaaaaaa")
        self.assertTrue(result["tag"].startswith("editor-preview-"))
        self.assertEqual(result["preview"], "true")
        self.assertNotEqual(result["tag"], self.resolve(preview=True, attempt="2")["tag"])

    def test_preview_rejects_ambiguous_or_invalid_inputs(self):
        for override in (dict(event="release"), dict(requested_tag="v0.9.1"),
                         dict(sha="main"), dict(run_id="../123"), dict(attempt="0")):
            with self.assertRaises(ValueError):
                self.resolve(preview=True, **override)


if __name__ == "__main__":
    unittest.main()
