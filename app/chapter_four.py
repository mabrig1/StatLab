"""Research-ready Chapter Four drafts strictly from verified marginal frequencies.

No respondent-level rows, covariance, joint distributions, inferential statistics,
response rates, or combined respondent-level scale scores can be recovered here.
"""
from __future__ import annotations

import csv
from html import escape
from io import BytesIO, StringIO
import math
import re
from typing import Any


class ChapterFourError(ValueError):
    """Invalid report metadata or objective-to-item assignments."""


LIMITATIONS = (
    "The supplied figures are marginal frequency distributions for individual questionnaire items. "
    "They do not identify how any respondent answered other items. Therefore correlations, "
    "regressions, group comparisons (t-tests or ANOVA), Cronbach's alpha, factor analysis, "
    "respondent-level composite scores, and hypothesis significance cannot be computed "
    "from this input alone. Neither sample-size nor population-size metadata reconstruct "
    "paired observations. Treat numeric Likert means/SD as summaries based on an "
    "approximately equally spaced coding convention; the underlying response categories are ordinal."
)


def _text(value: Any, label: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ChapterFourError(f'{label} must be text.')
    value = value.strip()
    if len(value) > limit:
        raise ChapterFourError(f'{label} must be {limit} characters or fewer.')
    if any(ord(ch) < 32 and ch not in '\n\r\t' for ch in value):
        raise ChapterFourError(f'{label} contains a prohibited control character.')
    return value


def _fmt(value: Any, places: int = 2) -> str:
    if value is None:
        return 'Not defined'
    if isinstance(value, (int, float)) and not math.isfinite(float(value)):
        return 'Not defined'
    return f'{value:,.{places}f}'


def build_chapter_four(
    analysis: dict,
    *,
    research_title: str = '',
    objectives: list[str] | None = None,
    item_objectives: dict[str, int] | None = None,
    source_label: str = '',
) -> dict:
    """Create verifiable sections from a fresh frequency-only result.

    Mapping indices are 1-based. Unassigned items remain separately identified,
    rather than silently being attributed to a research objective.
    """
    research_title = _text(research_title, 'Research title', 240)
    source_label = _text(source_label, 'Data source label', 200) or 'User-supplied frequency counts (not independently verified)'
    objectives = objectives or []
    if not isinstance(objectives, list) or len(objectives) > 12:
        raise ChapterFourError('Provide at most 12 research objectives.')
    titles = []
    for idx, objective in enumerate(objectives, 1):
        name = _text(objective, f'Objective {idx}', 350)
        if not name:
            raise ChapterFourError(f'Objective {idx} must not be blank.')
        titles.append(name)
    if not isinstance(item_objectives, dict) and item_objectives is not None:
        raise ChapterFourError('Item assignments must be a dictionary.')
    item_objectives = item_objectives or {}
    items = analysis['items']
    names = {x['item'] for x in items}
    if unknown := set(item_objectives) - names:
        raise ChapterFourError('Assignments reference unknown item(s): ' + ', '.join(sorted(unknown)[:5]))
    assignments = {}
    for name, index in item_objectives.items():
        if isinstance(index, bool) or not isinstance(index, int) or index < 1 or index > len(titles):
            raise ChapterFourError(f'{name}: select a research objective between 1 and {len(titles)}.')
        assignments[name] = index
    groups = [{'name': f'Objective {i}: {title}', 'objective_index': i, 'items': []}
              for i, title in enumerate(titles, 1)]
    unassigned = {'name': 'Items not assigned to an objective', 'objective_index': None, 'items': []}
    summary = []
    table_number = 1
    for item in items:
        name = item['item']
        index = assignments.get(name)
        group = groups[index - 1] if index is not None else unassigned
        rows = [{'category': entry['label'], 'code': entry['code'],
                 'frequency': entry['frequency'], 'percent': entry['percentage']}
                for entry in item['table']]
        reversed_text = ('The scoring was reversed for this item; category frequencies and labels remain in '
                         'their original direction. ' if item['reversed'] else '')
        sentence = (
            f"For {name}, {item['n']:,} valid category responses were provided. "
            f"The most frequent response was {item['top_response']} "
            f"({item['top_frequency']:,}; {item['top_percentage']:.2f}%). "
            f"The frequency-weighted mean was {_fmt(item['mean'])}; "
            f"the {item['sd_method']} standard deviation was {_fmt(item['sd'])}. "
            f"The scored median was {_fmt(item['median'])}, and the scored mode was {item['mode']}. "
            + reversed_text +
            'These results describe the item distribution; they do not establish a causal explanation or statistical significance.'
        )
        entry = {
            'name': name, 'objective_index': index, 'table_number': f'4.{table_number}',
            'n': item['n'], 'rows': rows, 'mean': item['mean'], 'sd': item['sd'],
            'mode': item['mode'], 'median': item['median'], 'top_response': item['top_response'],
            'top_frequency': item['top_frequency'], 'top_percentage': item['top_percentage'],
            'reversed': item['reversed'], 'discussion': sentence,
            'sd_method': item['sd_method'], 'fx_sum': item['formula']['fx_sum'],
            'squared_sum': item['formula']['squared_sum'],
            'denominator': item['formula']['denominator'],
        }
        group['items'].append(entry)
        summary.append({'item': name, 'objective': (f'Objective {index}' if index else 'Unassigned'),
                        'n': item['n'], 'mean': item['mean'], 'sd': item['sd'],
                        'mode': item['mode'], 'median': item['median'],
                        'top_response': item['top_response'], 'top_percent': item['top_percentage']})
        table_number += 1
    groups = [g for g in groups if g['items']] + ([unassigned] if unassigned['items'] else [])
    # Table numbering follows the final printed objective order, not input item order.
    for table_num, section_item in enumerate((i for g in groups for i in g['items']), 1):
        section_item['table_number'] = f'4.{table_num}'
    md = analysis['metadata']
    population, sample = md.get('population_size'), md.get('sample_size')
    if sample is not None:
        size_sentence = f'The declared overall sample size was {sample:,}.'
    else:
        size_sentence = 'No overall sample size was declared.'
    if population is not None:
        size_sentence += f' The declared target population was {population:,}.'
    size_sentence += (
        ' These figures are metadata only: valid N is calculated separately as the sum of supplied '
        'frequency counts for each item. No questionnaire return rate can be calculated from these inputs.'
    )
    distinct_n = sorted({x['n'] for x in items})
    if len(distinct_n) > 1:
        size_sentence += (' Valid totals differ across items (' + ', '.join(map(str, distinct_n[:15])) +
                          (' …' if len(distinct_n) > 15 else '') +
                          '); do not assume that they represent the same complete set of respondents.')
    method = analysis['method']
    return {
        'title': research_title or 'Survey study (title not provided)',
        'source': source_label, 'groups': groups, 'summary': summary,
        'n_items': len(summary), 'coverage': size_sentence, 'method': method,
        'limitations': LIMITATIONS,
        'review_note': ('DRAFT FOR RESEARCHER REVIEW: Check every input count, objective assignment, '
                        'reverse-coding instruction, question wording and source label against the original records. '
                        'No hypothesis test or empirical citation has been generated.'),
    }


def _html_table(headers: list[str], rows: list[list[str]]) -> str:
    h = '<thead><tr>' + ''.join(f'<th scope="col">{escape(str(x))}</th>' for x in headers) + '</tr></thead>'
    b = ''.join('<tr>' + ''.join(f'<td>{escape(str(x))}</td>' for x in row) + '</tr>' for row in rows)
    return f'<table>{h}<tbody>{b}</tbody></table>'


def chapter_four_html(report: dict) -> str:
    """Complete, script-free, Word-readable HTML with escaped user input."""
    esc = lambda v: escape(str(v))
    parts = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
        f'<title>Chapter Four — {esc(report["title"])}</title>',
        '<style>body{font-family:Georgia,"Times New Roman",serif;max-width:950px;margin:35px auto;padding:0 22px;color:#1e2e35;font-size:15px;line-height:1.65}'
        'h1{text-align:center;font-size:22px}h2{font-size:18px;margin-top:30px}h3{font-size:16px;margin-top:24px}h4{margin-bottom:5px}'
        'p{margin:9px 0 13px}table{border-collapse:collapse;width:100%;margin:12px 0 7px;font-size:12px}td,th{border:1px solid #8b9699;padding:7px;text-align:left}th{background:#f3f6f5}'
        '.table-wrap{overflow-x:auto}.note{font-size:12px;color:#45616a}.warning{border:1px solid #d5b46a;background:#fff9e8;padding:10px 13px}'
        '.caption{font-weight:bold;margin-bottom:3px}.source{font-size:12px;margin:3px 0 20px}.discussion{margin-top:7px}@media print{body{margin:10mm}.warning{background:white}h3{break-after:avoid}.table-wrap{break-inside:avoid}}</style></head><body>',
        '<h1>CHAPTER FOUR</h1><h1>DATA PRESENTATION, ANALYSIS AND DISCUSSION OF FINDINGS</h1>',
        f'<p><b>Study:</b> {esc(report["title"])}</p>',
        f'<p class="warning"><b>Researcher review required:</b> {esc(report["review_note"])}</p>',
        '<h2>4.1 Introduction</h2><p>This chapter presents descriptive statistics derived solely from the frequency counts supplied for individual questionnaire items. '
        'Frequency tables show original response labels, and the numerical mean and standard deviation use the questionnaire coding and any specified reverse-scoring.</p>',
        '<h2>4.2 Survey Coverage and Analytical Basis</h2>',
        f'<p>{esc(report["coverage"])}</p><p>{esc(report["method"])}</p>',
        '<h2>4.3 Data Presentation and Descriptive Statistics</h2>',
    ]
    for group in report['groups']:
        parts.append(f'<h3>{esc(group["name"])}</h3>')
        for item in group['items']:
            parts.append(f'<p class="caption">Table {esc(item["table_number"])}: Response Distribution for {esc(item["name"])}</p>')
            rows = [[r['category'], f"{r['frequency']:,}", f"{r['percent']:.2f}%"] for r in item['rows']]
            rows.append(['Total', f"{item['n']:,}", '100.00%'])
            parts.append('<div class="table-wrap">' + _html_table(['Response category', 'Frequency', 'Percent'], rows) + '</div>')
            parts.append(f'<p class="source"><b>Source:</b> {esc(report["source"])}</p>')
            parts.append(f'<p><b>Item statistics:</b> Valid N = {item["n"]:,}; Mean = {_fmt(item["mean"])}; '
                         f'{esc(item["sd_method"].capitalize())} SD = {_fmt(item["sd"])}; Median = {_fmt(item["median"])}; '
                         f'Mode = {esc(item["mode"])}.</p>')
    parts.append('<h2>4.4 Discussion of Descriptive Findings</h2>')
    for group in report['groups']:
        parts.append(f'<h3>{esc(group["name"])}</h3>')
        for item in group['items']:
            parts.append(f'<p class="discussion">{esc(item["discussion"])}</p>')
        if len(group['items']) > 1:
            parts.append('<p class="note">Each item above was analysed independently. Do not interpret these means as a '
                         'respondent-level combined score or compare them as a statistical significance test.</p>')
    parts.append('<h2>4.5 Limitations of Frequency-Only Analysis</h2>')
    parts.append(f'<p>{esc(report["limitations"])}</p>')
    parts.append('<p class="note">This draft deliberately contains no invented respondent-level records, response rates, '
                 'hypothesis-test results, p-values, literature citations or causal claims.</p></body></html>')
    return ''.join(parts)


def chapter_four_csv(report: dict) -> str:
    """CSV of item-level summaries, protecting against spreadsheet formulas."""
    out = StringIO()
    writer = csv.writer(out)
    writer.writerow(['Item', 'Objective', 'Valid N', 'Mean', 'SD', 'Median', 'Mode', 'Top response', 'Top response %'])
    def protect(s):
        v = str(s)
        return "'" + v if re.match(r'^\s*[=+@\-\t\r]', v) else v
    for row in report['summary']:
        writer.writerow([protect(row['item']), row['objective'], row['n'], _fmt(row['mean'], 4),
                         '' if row['sd'] is None else _fmt(row['sd'], 4),
                         _fmt(row['median'], 4), protect(row['mode']), protect(row['top_response']),
                         _fmt(row['top_percent'], 2)])
    return out.getvalue()


def chapter_four_docx(report: dict) -> bytes:
    """Editable academic draft; formatted without publisher/source fabrication."""
    from docx import Document
    from docx.shared import Inches, Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    doc = Document()
    section = doc.sections[0]
    section.top_margin = section.bottom_margin = Inches(0.9)
    section.left_margin = section.right_margin = Inches(1.0)
    normal = doc.styles['Normal']
    normal.font.name = 'Times New Roman'
    normal.font.size = Pt(12)
    normal.paragraph_format.line_spacing = 1.5
    normal.paragraph_format.space_after = Pt(2)
    for key in ['Heading 1', 'Heading 2', 'Heading 3']:
        style = doc.styles[key]
        style.font.name = 'Times New Roman'
        style.font.color.rgb = None
        style.font.bold = True
        style.font.size = Pt(14 if key == 'Heading 1' else 12)

    def para(value, bold_prefix=None):
        p = doc.add_paragraph()
        if bold_prefix:
            p.add_run(bold_prefix).bold = True
        p.add_run(value)
        return p

    title = doc.add_paragraph('CHAPTER FOUR')
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.runs[0].bold = True
    title = doc.add_paragraph('DATA PRESENTATION, ANALYSIS AND DISCUSSION OF FINDINGS')
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.runs[0].bold = True
    para(report['title'], 'Study: ')
    para(report['review_note'], 'DRAFT — ')
    doc.add_heading('4.1 Introduction', 1)
    para('This chapter reports descriptive statistics calculated from the supplied frequency counts for individual questionnaire items. Original category frequencies and percentages are presented alongside frequency-weighted means and standard deviations. No individual respondent records have been reconstructed.')
    doc.add_heading('4.2 Survey Coverage and Analytical Basis', 1)
    para(report['coverage'])
    para(report['method'])
    descriptive_heading = doc.add_heading('4.3 Data Presentation and Descriptive Statistics', 1)
    descriptive_heading.paragraph_format.page_break_before = True
    first_item = True
    for group in report['groups']:
        group_heading = doc.add_heading(group['name'], 2)
        if not first_item:
            group_heading.paragraph_format.page_break_before = True
        for item_index, item in enumerate(group['items']):
            caption = para(f'Table {item["table_number"]}: Response Distribution for {item["name"]}')
            caption.paragraph_format.keep_with_next = True
            if item_index > 0:
                caption.paragraph_format.page_break_before = True
            first_item = False
            table = doc.add_table(rows=1, cols=3)
            table.style = 'Table Grid'
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            header = ['Response category', 'Frequency', 'Percent']
            for cell, value in zip(table.rows[0].cells, header):
                cell.text = value
                for run in cell.paragraphs[0].runs:
                    run.bold = True
            trPr = table.rows[0]._tr.get_or_add_trPr()
            tblHeader = OxmlElement('w:tblHeader')
            tblHeader.set(qn('w:val'), 'true')
            trPr.append(tblHeader)
            for entry in item['rows']:
                cells = table.add_row().cells
                cells[0].text = entry['category']
                cells[1].text = f'{entry["frequency"]:,}'
                cells[2].text = f'{entry["percent"]:.2f}%'
            last = table.add_row().cells
            last[0].text, last[1].text, last[2].text = 'Total', f'{item["n"]:,}', '100.00%'
            for cell in last:
                for run in cell.paragraphs[0].runs:
                    run.bold = True
            # Keep short frequency tables together instead of splitting midway across pages.
            if len(table.rows) <= 15:
                for row in table.rows[:-1]:
                    for cell in row.cells:
                        for par in cell.paragraphs:
                            par.paragraph_format.keep_with_next = True
            para(report['source'], 'Source: ')
            para(f'Valid N = {item["n"]:,}; Mean = {_fmt(item["mean"])}; '
                 f'{item["sd_method"].capitalize()} SD = {_fmt(item["sd"])}; '
                 f'Median = {_fmt(item["median"])}; Mode = {item["mode"]}.', 'Item statistics: ')
    doc.add_heading('4.4 Discussion of Descriptive Findings', 1)
    for group in report['groups']:
        doc.add_heading(group['name'], 2)
        for item in group['items']:
            para(item['discussion'])
        if len(group['items']) > 1:
            para('The items were analysed independently; their means do not constitute a respondent-level combined score.')
    doc.add_heading('4.5 Limitations of Frequency-Only Analysis', 1)
    para(report['limitations'])
    output = BytesIO()
    doc.save(output)
    return output.getvalue()
