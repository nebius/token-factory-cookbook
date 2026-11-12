#!/usr/bin/env python3
"""Build the cookbook cover using the supplied communication design system.

Run with: uv run --no-project --with fonttools .github/scripts/build_brand_banner.py \
    --design-system /path/to/design-system

Text is outlined so the SVG renders consistently without redistributing fonts.
"""
from __future__ import annotations

import argparse
from pathlib import Path
from xml.etree import ElementTree as ET

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
ROOT = Path(__file__).resolve().parents[2]


def element(tag, **attrs):
    return ET.Element(f'{{{NS}}}{tag}', {k.replace('_', '-'): str(v) for k, v in attrs.items()})


def text_paths(parent, text, font_path, size, x, baseline, color='#FFFFFF', tracking=0):
    font = TTFont(font_path)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font['head'].unitsPerEm
    group = element('g', fill=color, aria_label=text)
    cursor = x
    for character in text:
        name = cmap[ord(character)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline)))
        path = pen.getCommands()
        if path:
            group.append(element('path', d=path))
        cursor += font['hmtx'][name][0] * scale + tracking
    parent.append(group)
    font.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--design-system', required=True, type=Path)
    args = parser.parse_args()
    fonts = args.design_system / 'assets/fonts'
    svg = element('svg', width=1280, height=400, viewBox='0 0 1280 400', role='img', aria_labelledby='title description')
    title = element('title', id='title')
    title.text = 'Nebius Token Factory Cookbook'
    description = element('desc', id='description')
    description.text = 'Guides and examples for building with open models. APIs, agents, applications, and evaluations.'
    svg.extend([title, description, element('rect', width=1280, height=400, fill='#001A2B')])
    logo = ET.parse(ROOT / '.github/brand/token-factory-logo.svg').getroot()
    logo.set('x', '64')
    logo.set('y', '48')
    svg.append(logo)
    text_paths(svg, 'Cookbook', fonts / 'GramatikaBold.otf', 72, 64, 232, tracking=-1.8)
    text_paths(svg, 'Guides and examples for building with open models.', fonts / 'Inter-Regular.ttf', 18, 64, 280)
    svg.append(element('rect', x=864, y=48, width=352, height=304, rx=16, fill='#052B42'))
    text_paths(svg, 'Start building', fonts / 'Inter-SemiBold.ttf', 24, 896, 108)
    for y, label in [(168, 'APIs and model guides'), (232, 'Agents and applications'), (296, 'Evaluation and adaptation')]:
        svg.append(element('circle', cx=900, cy=y - 6, r=4, fill='#DAFF33'))
        text_paths(svg, label, fonts / 'Inter-Regular.ttf', 16, 920, y)
    text_paths(svg, 'Nebius Token Factory', fonts / 'Inter-Medium.ttf', 14, 64, 352, color='#C1C1FF')
    ET.indent(svg, space='  ')
    output = ROOT / '.github/brand/cookbook-banner.svg'
    output.write_bytes(ET.tostring(svg, encoding='utf-8', xml_declaration=True))
    print(output)


if __name__ == '__main__':
    main()
