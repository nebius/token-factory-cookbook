import ast
import re
import unittest
from pathlib import Path


README = Path(__file__).with_name('README.md')


class PixeltableRecipeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = README.read_text(encoding='utf-8')

    def test_python_blocks_compile(self) -> None:
        blocks = re.findall(r'```python\n(.*?)```', self.text, flags=re.DOTALL)
        self.assertGreaterEqual(len(blocks), 2)
        for block in blocks:
            ast.parse(block)

    def test_secret_is_not_assigned_in_python(self) -> None:
        self.assertNotRegex(self.text, r"os\.environ\[['\"]NEBIUS_API_KEY['\"]\]\s*=")
        self.assertIn('export NEBIUS_API_KEY=your_key_here', self.text)

    def test_model_is_overridable(self) -> None:
        self.assertRegex(self.text, r"os\.getenv\(\s*'NEBIUS_CHAT_MODEL'")
        self.assertIn('model=CHAT_MODEL', self.text)

    def test_native_route_is_named_without_responses_claim(self) -> None:
        self.assertIn('native Nebius Token Factory provider', self.text)
        self.assertRegex(
            self.text,
            r'does not add\s+another provider or claim Responses API support',
        )


if __name__ == '__main__':
    unittest.main()
