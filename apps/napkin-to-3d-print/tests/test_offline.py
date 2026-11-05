"""Credential-free checks: no Token Factory calls, no network.

Run from the recipe directory: uv run python -m unittest discover -s tests
The build test runs CadQuery in the same sandboxed subprocess the app uses.
"""

import math
import unittest

from cad_agent import execute, extract_code, strip_code
from cad_runner import GuardError, check_code, resolve_params, safe_builtins

BRACKET = '''import cadquery as cq

PARAMS = {
    "width": {"value": 40.0, "min": 20.0, "max": 80.0, "step": 1.0, "unit": "mm", "label": "Width"},
    "holes": {"value": 2, "min": 0, "max": 4, "step": 1, "type": "int", "label": "Holes"},
}

def build(p):
    plate = cq.Workplane("XY").box(p["width"], 20, 4)
    if p["holes"]:
        pts = [(-p["width"] / 4, 0), (p["width"] / 4, 0)][: p["holes"]]
        plate = plate.faces(">Z").workplane().pushPoints(pts).hole(4.4)
    return safe_fillet(plate, 1.0, "|Z")
'''


class GuardTest(unittest.TestCase):
    def test_allows_a_normal_model(self):
        check_code(BRACKET)
        check_code("import math\nimport numpy as np\nfrom math import radians, tan\nfrom cadquery import Workplane")

    def test_blocks_escape_hatches(self):
        for source in (
            "import os",
            "from subprocess import run",
            "open('/etc/passwd')",
            "eval('1')",  # a string for the guard to reject, never executed
            "run = exec",
            "x = ().__class__",
            "__builtins__",
            # submodules and from-imports of blocked names
            "import numpy.ctypeslib as c",
            "from numpy import save",
            "from cadquery import exporters",
            "from cadquery import *",
            "from . import cad_agent",
            # file I/O methods on cadquery and numpy objects
            "import cadquery as cq\ncq.exporters.export(None, 'x.stl')",
            "import cadquery as cq\ncq.Workplane().box(1, 1, 1).export('x.stl')",
            "import cadquery as cq\ncq.Workplane().box(1, 1, 1).val().exportStl('x.stl')",
            "import cadquery as cq\ncq.importers.importStep('x.step')",
            "import numpy as np\nnp.save('x', 1)",
            "import numpy as np\nnp.zeros(3).tofile('x')",
            "import numpy as np\nnp.DataSource().open('https://example.com')",
            # modules that run source or reach raw OpenCascade
            "import cadquery as cq\ncq.cqgi.parse('import os').build()",
            "import cadquery as cq\ncq.occ_impl.shapes.BRepTools.Write_s(None, 'x')",
        ):
            with self.subTest(source=source), self.assertRaises(GuardError):
                check_code(source)

    def test_runtime_import_guard(self):
        guarded = safe_builtins()
        self.assertNotIn("open", guarded)
        self.assertNotIn("exec", guarded)
        self.assertIs(guarded["__import__"]("math"), math)
        for name, fromlist in (("os", ()), ("numpy.ctypeslib", ()), ("cadquery", ("exporters",))):
            with self.subTest(name=name), self.assertRaises(ImportError):
                guarded["__import__"](name, None, None, fromlist, 0)

    def test_params_are_clamped_and_typed(self):
        spec = {"w": {"value": 40.0, "min": 20.0, "max": 80.0}, "n": {"value": 2, "type": "int", "max": 4}}
        self.assertEqual(resolve_params(spec, {"w": 500, "n": 3.6}), {"w": 80.0, "n": 4})
        with self.assertRaises(ValueError):
            resolve_params({"w": 40}, {})


class ReplyParsingTest(unittest.TestCase):
    def test_extract_code_takes_the_longest_python_block(self):
        reply = "## Interpretation\n```python\nx = 1\n```\nthen\n```python\n" + BRACKET + "```"
        self.assertEqual(extract_code(reply), BRACKET)
        self.assertEqual(strip_code(reply), "## Interpretation\n\nthen")

    def test_extract_code_without_a_block_fails(self):
        with self.assertRaises(ValueError):
            extract_code("VERDICT: PASS")


class BuildTest(unittest.TestCase):
    def test_builds_exports_and_renders_a_part(self):
        build = execute(BRACKET, {"width": 60})
        self.assertTrue(build.ok, build.error)
        self.assertEqual(build.size, [60.0, 20.0, 4.0])
        self.assertEqual(build.solids, 1)
        self.assertTrue(build.valid and build.watertight)
        self.assertTrue(build.stl and build.step)
        self.assertTrue(build.render_png.startswith(b"\x89PNG"))

    def test_rejected_code_comes_back_as_a_build_error(self):
        build = execute("import os\nos.system('echo hi')\n")
        self.assertFalse(build.ok)
        self.assertIn("GuardError", build.error)


if __name__ == "__main__":
    unittest.main()
