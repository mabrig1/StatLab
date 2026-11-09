"""Generate demonstrative Chapter Four exports from a supplied frequency-only JSON.

Run: python scripts/chapter_four_example.py
Outputs are examples only, NEVER field-survey findings.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.aggregate_descriptives import analyze_frequencies
from app.chapter_four import build_chapter_four, chapter_four_csv, chapter_four_docx, chapter_four_html


def main() -> None:
    spec = json.loads((ROOT / 'samples' / 'chapter_four_example_request.json').read_text())
    report = build_chapter_four(analyze_frequencies(**spec['analysis']),
                                research_title=spec['research_title'],
                                objectives=spec['objectives'],
                                item_objectives=spec['item_objectives'],
                                source_label=spec['source_label'])
    output = ROOT / 'examples_generated'
    output.mkdir(exist_ok=True)
    (output / 'chapter-four-example.docx').write_bytes(chapter_four_docx(report))
    (output / 'chapter-four-example.html').write_text(chapter_four_html(report), encoding='utf-8')
    (output / 'chapter-four-example.csv').write_text(chapter_four_csv(report), encoding='utf-8')
    print(f'Wrote 3 demo files to: {output}\nNot field data: do not cite as survey findings.')


if __name__ == '__main__':
    main()
