"""Credential-free checks: no Token Factory calls, no network.

Run from the recipe directory: uv run python -m unittest discover -s tests
"""

import unittest

import pymupdf

from explainer_agent import (
    KIT_JS,
    apply_patches,
    assemble,
    extract_html,
    extract_section,
    parse_json,
    static_check,
)
from paper import load_pdf, parse_arxiv_id


def _two_page_pdf() -> bytes:
    doc = pymupdf.open()
    first = doc.new_page()
    first.insert_text((72, 72), "Attention Is All You Need, but shorter")
    second = doc.new_page()
    second.insert_text((72, 72), "Figure 1: the model architecture")
    for i in range(120):
        second.draw_line((72, 100 + i * 4), (300, 100 + i * 4))
    data = doc.tobytes()
    doc.close()
    return data


class PaperLoadingTest(unittest.TestCase):
    def test_parse_arxiv_id_from_links_and_bare_ids(self):
        self.assertEqual(parse_arxiv_id("https://arxiv.org/abs/1706.03762"), "1706.03762")
        self.assertEqual(parse_arxiv_id("arxiv.org/pdf/2501.12948v2"), "2501.12948v2")
        self.assertEqual(parse_arxiv_id("1706.03762"), "1706.03762")
        self.assertIsNone(parse_arxiv_id("not a paper"))
        self.assertIsNone(parse_arxiv_id(""))

    def test_load_pdf_extracts_text_and_figure_pages(self):
        paper = load_pdf(_two_page_pdf(), source_url="https://example.org/paper")
        self.assertEqual(paper.page_count, 2)
        self.assertIn("[page 1]", paper.text)
        self.assertIn("Figure 1", paper.text)
        self.assertEqual([page for page, _ in paper.figures], [2])
        self.assertTrue(paper.figures[0][1].startswith(b"\xff\xd8"))  # JPEG
        self.assertEqual(paper.title, "Attention Is All You Need, but shorter")


class ModelOutputParsingTest(unittest.TestCase):
    def test_parse_json_inside_a_fence(self):
        plan = parse_json('Here is the plan:\n```json\n{"sections": [{"id": "s1"}]}\n```')
        self.assertEqual(plan["sections"][0]["id"], "s1")

    def test_parse_json_rejects_prose(self):
        with self.assertRaises(ValueError):
            parse_json("I could not read the paper.")

    def test_extract_html_strips_preamble(self):
        reply = "Sure!\n```html\n<!doctype html><html><body>hi</body></html>\n```"
        self.assertEqual(extract_html(reply), "<!doctype html><html><body>hi</body></html>")

    def test_extract_section_keeps_trailing_script(self):
        reply = '```html\n<section id="s1">x</section>\n<script>init()</script>\n```'
        self.assertEqual(extract_section(reply, "s1"), '<section id="s1">x</section><script>init()</script>')

    def test_extract_section_wraps_bare_markup(self):
        self.assertEqual(extract_section("<p>x</p>", "s2"), '<section id="s2" class="lesson">\n<p>x</p>\n</section>')


class AssemblyTest(unittest.TestCase):
    SHELL = "<html><head><title>t</title></head><body><main><!--SECTION:s1--></main></body></html>"

    def test_sections_fill_placeholders_and_kit_is_injected(self):
        html = assemble(self.SHELL, {"s1": '<section id="s1">one</section>'})
        self.assertIn('<main><section id="s1">one</section></main>', html)
        self.assertIn(KIT_JS + "</head>", html)

    def test_section_without_placeholder_lands_before_main_close(self):
        html = assemble(self.SHELL, {"s1": "<section id='s1'></section>", "s9": "<section id='s9'></section>"})
        self.assertIn("<section id='s9'></section>\n</main>", html)

    def test_static_check_flags_truncation_and_missing_sections(self):
        issues = static_check("<html><section></section>", {"sections": [{}, {}]})
        self.assertEqual(len(issues), 2)
        self.assertEqual(static_check("<html><section></section></html>", {"sections": [{}]}), [])


class PatchTest(unittest.TestCase):
    HTML = "<div>\n  <p>old</p>\n</div>\n<span>x</span>\n<span>x</span>"

    def test_exact_patch(self):
        reply = "<<<<<<< SEARCH\n  <p>old</p>\n=======\n  <p>new</p>\n>>>>>>> REPLACE"
        html, applied, failed = apply_patches(self.HTML, reply)
        self.assertEqual((applied, failed), (1, []))
        self.assertIn("<p>new</p>", html)

    def test_whitespace_insensitive_patch(self):
        reply = "<<<<<<< SEARCH\n<div>\n<p>old</p>\n=======\n<section>\n<p>new</p>\n>>>>>>> REPLACE"
        html, applied, _ = apply_patches(self.HTML, reply)
        self.assertEqual(applied, 1)
        self.assertTrue(html.startswith("<section>\n<p>new</p>\n</div>"))

    def test_ambiguous_or_missing_search_is_reported(self):
        reply = (
            "<<<<<<< SEARCH\n<span>x</span>\n=======\n<b>y</b>\n>>>>>>> REPLACE\n"
            "<<<<<<< SEARCH\n<em>gone</em>\n=======\n<b>z</b>\n>>>>>>> REPLACE"
        )
        html, applied, failed = apply_patches(self.HTML, reply)
        self.assertEqual(applied, 0)
        self.assertEqual(len(failed), 2)
        self.assertEqual(html, self.HTML)


if __name__ == "__main__":
    unittest.main()
