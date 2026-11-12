"""Offline checks: re-score the recorded run without images, a key, or the network."""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("score", ROOT / "scripts" / "score.py")
score = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(score)


class RecordedRunTest(unittest.TestCase):
    def test_recorded_responses_reproduce_committed_verdicts(self):
        manifest = json.loads((ROOT / "data" / "manifest.json").read_text())
        committed = {r["id"]: r for r in json.loads((ROOT / "results" / "scored.json").read_text())}
        self.assertEqual(len(manifest), 60)
        hits = 0
        for sample in manifest:
            with self.subTest(sample=sample["id"]):
                raw_path = ROOT / "results" / "raw" / (sample["id"].replace("/", "__") + ".json")
                raw = json.loads(raw_path.read_text())
                result = score.score(sample, score.parse_json(raw["content"]))
                self.assertEqual(result["verdict"], committed[sample["id"]]["verdict"])
                self.assertAlmostEqual(result["metric"], committed[sample["id"]]["metric"], places=6)
                hits += result["verdict"] == "hit"
        self.assertEqual(hits, 48)

    def test_every_committed_overlay_exists(self):
        for record in json.loads((ROOT / "results" / "scored.json").read_text()):
            with self.subTest(sample=record["id"]):
                self.assertTrue((ROOT / record["viz"]).is_file(), record["viz"])


class HelperTest(unittest.TestCase):
    def test_parse_json_takes_last_fenced_block(self):
        text = 'Thinking {"draft": 1}\n```json\n{"count": 3}\n```\nthen\n```json\n{"count": 4}\n```'
        self.assertEqual(score.parse_json(text), {"count": 4})

    def test_parse_json_falls_back_to_trailing_object(self):
        self.assertEqual(score.parse_json('The answer is {"answer": "yes", "bbox": null}.'),
                         {"answer": "yes", "bbox": None})
        self.assertIsNone(score.parse_json("no json here"))

    def test_iou(self):
        self.assertAlmostEqual(score.iou([0, 0, 10, 10], [0, 0, 10, 10]), 1.0)
        self.assertAlmostEqual(score.iou([0, 0, 10, 10], [5, 0, 15, 10]), 50 / 150)
        self.assertEqual(score.iou([0, 0, 1, 1], [2, 2, 3, 3]), 0.0)

    def test_anls(self):
        self.assertEqual(score.anls("Dr. Smith", ["dr. smith"]), 1.0)
        self.assertAlmostEqual(score.anls("hybrid", ["hybride"]), 1 - 1 / 7)
        self.assertEqual(score.anls("cat", ["elephant"]), 0.0)


if __name__ == "__main__":
    unittest.main()
