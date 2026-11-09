"""Descriptive statistics from frequency-only survey summaries.

No case-level dataset is generated, inferred, simulated, expanded or retained.
Without respondent-level pairing, joint distributions and inferential statistics
cannot be reconstructed. The supplied frequency counts are the sole numeric input.
"""
from __future__ import annotations

import ast
import csv
import io
import json
import math
import re
from collections import OrderedDict
from typing import Any

import pandas as pd


class SummaryError(ValueError):
    """Raised when counts cannot be parsed unambiguously or validated."""


DEFAULT_LABELS = {
    "1": "Strongly Disagree", "2": "Disagree", "3": "Neutral",
    "4": "Agree", "5": "Strongly Agree",
}
MAX_TEXT = 100_000
MAX_ITEMS = 100
MAX_TOTAL = 10_000_000
MAX_CATEGORIES = 11
LIMITATIONS = (
    "Frequency-only inputs support per-item counts, percentages, mean, sample SD, "
    "mode and median. They do NOT reveal which responses belong to the same "
    "person. Consequently this mode cannot compute correlations, regression, "
    "t-tests, ANOVA, Cronbach's alpha, paired comparisons, cross-item composites, "
    "or any analysis requiring respondent-level pairing or joint distributions. "
    "Population and sample sizes entered as metadata cannot reconstruct those links. "
    "Single-item Likert means/SD assume ordered response codes are meaningfully "
    "spaced; interpret them cautiously because Likert categories are ordinal."
)


def _norm(value: Any) -> str:
    return re.sub(r"[\s_\-]+", " ", str(value).casefold()).strip().strip('"\'')


def _int_count(value: Any, source: str) -> int:
    if isinstance(value, bool):
        raise SummaryError(f"{source}: counts must be non-negative whole numbers.")
    if isinstance(value, str):
        value = value.strip().replace(",", "")
        if not re.fullmatch(r"\+?\d+", value):
            raise SummaryError(f"{source}: frequency {value!r} is not a non-negative whole number.")
        value = int(value)
    elif not isinstance(value, int) or value < 0:
        raise SummaryError(f"{source}: frequency must be a non-negative whole number.")
    if value > MAX_TOTAL:
        raise SummaryError(f"{source}: frequency exceeds the {MAX_TOTAL:,} limit.")
    return value


def _codes(labels: dict[str, str]) -> list[tuple[str, float, str]]:
    if not isinstance(labels, dict) or not 2 <= len(labels) <= MAX_CATEGORIES:
        raise SummaryError(f"Define 2–{MAX_CATEGORIES} distinct numeric codes and their labels.")
    codes = []
    for raw, label in labels.items():
        try:
            numeric = float(raw)
        except (ValueError, TypeError):
            raise SummaryError(f"Invalid score {raw!r}: codes must be numbers.") from None
        if not math.isfinite(numeric) or abs(numeric) > 1_000_000 or not isinstance(label, str) or not label.strip() or len(label) > 120:
            raise SummaryError("Each code must be finite and have a nonempty label of 120 characters or less.")
        codes.append((str(raw), numeric, label.strip()))
    codes.sort(key=lambda p: p[1])
    if len({x[1] for x in codes}) != len(codes):
        raise SummaryError("Numeric scale codes must be unique.")
    if len({_norm(x[2]) for x in codes}) != len(codes):
        raise SummaryError("Response labels must be unique (ignoring capitalization).")
    return codes


def _lookup(codes: list[tuple[str, float, str]]) -> dict[str, str]:
    out = {}
    for original, numeric, label in codes:
        out[_norm(label)] = original
        out[_norm(original)] = original
        # Support typed numeric forms such as 1.0 for code 1
        out[_norm(str(numeric))] = original
    # Common unambiguous abbreviations for agreement labels.
    common = {"strongly disagree": "sd", "disagree": "d", "neutral": "n", "agree": "a", "strongly agree": "sa"}
    for original, _, label in codes:
        if _norm(label) in common:
            out[common[_norm(label)]] = original
    return out


def _parse_row(header: list[str], values: list[str], codes: list[tuple[str, float, str]], row: int,
               lookup: dict[str, str], result: dict[str, dict]) -> None:
    if len(values) != len(header):
        raise SummaryError(f"Table row {row}: expected {len(header)} columns, found {len(values)}.")
    names = [_norm(x) for x in header]
    item_idx = next((i for i, col in enumerate(names) if col in ('item', 'question', 'statement', 'variable')), -1)
    if item_idx < 0:
        raise SummaryError("Table needs a column headed Item, Question, Statement or Variable.")
    name = values[item_idx].strip()
    if not name or name in result:
        raise SummaryError(f"Table row {row}: item name is blank or repeated.")
    freq = {}
    declared = None
    for i, cell in enumerate(values):
        if i == item_idx:
            continue
        h = names[i]
        if h in ('total', 'total n', 'n', 'total responses'):
            if cell.strip():
                declared = _int_count(cell, f"{name} declared total")
            continue
        if not cell.strip():
            continue
        code = lookup.get(h)
        if code is None:
            raise SummaryError(f"Unknown table heading {header[i]!r}; use configured response labels or codes.")
        if code in freq:
            raise SummaryError(f"{name}: response category {header[i]!r} is repeated.")
        freq[code] = _int_count(cell, f"{name} — {header[i]}")
    result[name] = {'frequencies': freq, 'total': declared}


def _read_delimited_table(text: str, codes: list[tuple[str, float, str]]) -> dict | None:
    rows = [line.strip() for line in text.splitlines() if line.strip()]
    if not rows:
        return None
    if rows[0].startswith('|'):
        delim = '|'
    elif '\t' in rows[0]:
        delim = '\t'
    elif ',' in rows[0]:
        delim = ','
    else:
        return None
    def split(line: str) -> list[str]:
        if delim == '|':
            return [part.strip() for part in line.strip('|').split('|')]
        return [part.strip() for part in next(csv.reader([line], delimiter=delim))]
    header = split(rows[0])
    if not any(_norm(x) in ('item', 'question', 'statement', 'variable') for x in header):
        return None
    if len(header) < 3:
        raise SummaryError('Table needs Item and at least two category columns, or Item, Response, Frequency.')
    look = _lookup(codes)
    data_rows = [split(line) for line in rows[1:] if not re.fullmatch(r'[\s|:\-]+', line)]
    names = [_norm(x) for x in header]
    item_idx = next(i for i, h in enumerate(names) if h in ('item', 'question', 'statement', 'variable'))
    response_idx = next((i for i, h in enumerate(names) if h in ('response', 'category', 'rating', 'answer')), -1)
    freq_idx = next((i for i, h in enumerate(names) if h in ('frequency', 'count', 'freq')), -1)
    result: dict[str, dict] = OrderedDict()
    if response_idx >= 0 and freq_idx >= 0:
        for n, row in enumerate(data_rows, 2):
            if len(row) != len(header):
                raise SummaryError(f"Table row {n}: wrong number of columns.")
            item = row[item_idx].strip()
            if not item:
                raise SummaryError(f"Table row {n}: missing item name.")
            cat = look.get(_norm(row[response_idx]))
            if cat is None:
                raise SummaryError(f"Table row {n}: unknown category {row[response_idx]!r}.")
            entry = result.setdefault(item, {'frequencies': {}, 'total': None})
            if cat in entry['frequencies']:
                raise SummaryError(f"Table row {n}: repeated category for {item}.")
            entry['frequencies'][cat] = _int_count(row[freq_idx], f"{item} — {row[response_idx]}")
    else:
        for n, row in enumerate(data_rows, 2):
            _parse_row(header, row, codes, n, look, result)
    return result


def _parse_pair(text: str, lookup: dict[str, str]) -> tuple[str, int] | None:
    match = re.fullmatch(r"\s*(.+?)\s*(?:=|:|\s+[-–]>\s+)\s*([+-]?\d[\d,]*)\s*%?\s*", text)
    if not match:
        return None
    key = _norm(match.group(1))
    if key in lookup:
        return lookup[key], _int_count(match.group(2), match.group(1))
    return None


def _is_total(key: str) -> bool:
    return _norm(key) in ('total', 'total n', 'n', 'total responses', 'valid n')


def _parse_block_text(text: str, codes: list[tuple[str, float, str]]) -> dict[str, dict]:
    lookup = _lookup(codes)
    result: dict[str, dict] = OrderedDict()
    item: str | None = None
    for line_number, original in enumerate(text.splitlines(), 1):
        line = original.strip().strip('`')
        if not line or line.startswith('#') or line.startswith('//') or re.fullmatch(r'[-=_* ]{3,}', line):
            continue
        # Item 5 (5-point scale): or Item 6 [reverse]: 1=10, 2=...
        header = re.match(r'^(?:item|question|q|statement)\s+([^:=|]+?)\s*:\s*(.*)$', line, re.I)
        if header:
            item = (header.group(0).split(':', 1)[0]).strip()
            if len(item) > 180:
                raise SummaryError(f"Line {line_number}: item name too long.")
            # Strip scale annotation and keep explicit reverse marker as flag.
            reversed_marker = bool(re.search(r'\[(?:reverse|reversed)\]', item, re.I))
            item = re.sub(r'\s*\((?:\d+[- ]point\s+scale)\)', '', item, flags=re.I)
            item = re.sub(r'\s*\[(?:reverse|reversed)\]', '', item, flags=re.I).strip()
            if item in result:
                raise SummaryError(f"Line {line_number}: item {item!r} occurs twice.")
            result[item] = {'frequencies': {}, 'total': None, 'reversed': reversed_marker}
            line = header.group(2).strip()
            if not line:
                continue
        elif re.match(r'^(?:item|question|q|statement)\s+[^=:|,]+$', line, re.I) and not _parse_pair(line, lookup):
            item = re.sub(r'\s*\[(?:reverse|reversed)\]', '', line, flags=re.I).strip()
            marked = bool(re.search(r'\[(?:reverse|reversed)\]', line, re.I))
            if item in result:
                raise SummaryError(f"Line {line_number}: duplicate item {item!r}.")
            result[item] = {'frequencies': {}, 'total': None, 'reversed': marked}
            continue
        elif line.endswith(':') and not _is_total(line[:-1]) and _norm(line[:-1]) not in lookup:
            item = line[:-1].strip()
            if item in result:
                raise SummaryError(f"Line {line_number}: duplicate item {item!r}.")
            result[item] = {'frequencies': {}, 'total': None}
            continue
        if item is None:
            raise SummaryError(f"Line {line_number}: give an item heading, such as 'Item 5:', before counts.")
        entry = result[item]
        if line.startswith('|') and line.endswith('|'):
            line = line.strip('|')
        # Allow pairs separated by commas, semicolons, tabs or pipes.
        pieces = re.split(r'\s*[;|\t]\s*|\s*,\s*(?=[A-Za-z_ ]+\s*(?:=|:)|[+-]?\d+(?:\.\d+)?\s*(?:=|:))', line)
        if len(pieces) == 1:
            # Ordered count vector: 'Item 7: 3 2 4 8 1' or 'Item 7: 3,2,4,8,1'
            if re.fullmatch(r'[+-]?\d+(?:\s*,\s*[+-]?\d+)+', line):
                numbers = [v.strip() for v in line.split(',')]
            else:
                numbers = re.findall(r'[+-]?\d+', line)
            if (not ('=' in line or ':' in line) and len(numbers) == len(codes)
                    and re.fullmatch(r'[\d\s,+\-]+', line)):
                pieces = numbers
        if len(pieces) == len(codes) and all(re.fullmatch(r'[+-]?\d+', x.strip()) for x in pieces):
            for (code, _, _), value in zip(codes, pieces):
                if code in entry['frequencies']:
                    raise SummaryError(f"Line {line_number}: repeated category for {item}.")
                entry['frequencies'][code] = _int_count(value, item)
            continue
        for piece in pieces:
            piece = piece.strip()
            if not piece:
                continue
            total = re.fullmatch(r'\s*(?:total\s*(?:n|responses)?|valid\s*n|n)\s*(?:=|:)\s*([+-]?\d[\d,]*)\s*', piece, re.I)
            if total:
                if entry['total'] is not None:
                    raise SummaryError(f"Line {line_number}: repeated total for {item}.")
                entry['total'] = _int_count(total.group(1), f"{item} total")
                continue
            parsed = _parse_pair(piece, lookup)
            if parsed:
                category, frequency = parsed
                if category in entry['frequencies']:
                    raise SummaryError(f"Line {line_number}: repeated response category for {item}.")
                entry['frequencies'][category] = frequency
                continue
            raise SummaryError(
                f"Line {line_number}: cannot read {piece!r}. Enter 'Response = count', "
                "codes such as '1=30', or a table with Item and response columns."
            )
    if not result:
        raise SummaryError('No items found. Paste at least one item with response frequencies.')
    return result


def _parse_dictionary(pasted: Any, codes: list[tuple[str, float, str]]) -> dict[str, dict]:
    if not isinstance(pasted, dict) or not pasted:
        raise SummaryError("Paste a dictionary such as {'Item 5': {'Agree': 45, ...}}.")
    lookup = _lookup(codes)
    result = OrderedDict()
    for item, counts in pasted.items():
        if not isinstance(item, str) or not item.strip():
            raise SummaryError("Item names must be nonempty text.")
        if not isinstance(counts, dict) or not counts:
            raise SummaryError(f"{item}: use a dictionary mapping each response to its count.")
        meta_total = counts.get('total', counts.get('Total N'))
        reverse = counts.get('reversed', counts.get('reverse', False))
        if not isinstance(reverse, bool):
            raise SummaryError(f"{item}: reversed must be true or false.")
        pairs = counts.get('frequencies', counts)
        if not isinstance(pairs, dict):
            raise SummaryError(f"{item}: frequencies must be a dictionary.")
        freq = {}
        for key, value in pairs.items():
            if _norm(key) in ('total', 'total n', 'reverse', 'reversed'):
                continue
            code = lookup.get(_norm(key))
            if code is None:
                raise SummaryError(f"{item}: category {key!r} was not defined in your scale labels.")
            if code in freq:
                raise SummaryError(f"{item}: duplicate category after matching code and label.")
            freq[code] = _int_count(value, f"{item} {key}")
        result[item.strip()] = {'frequencies': freq, 'total': meta_total, 'reversed': reverse}
    return result


def parse_summary_input(text: str | None, items: dict | None,
                        codes: list[tuple[str, float, str]]) -> dict[str, dict]:
    if bool(text and text.strip()) == bool(items):
        raise SummaryError('Provide either pasted frequency text or an items dictionary, not both.')
    if items is not None:
        return _parse_dictionary(items, codes)
    if not isinstance(text, str) or not text.strip():
        raise SummaryError('Paste at least one frequency distribution.')
    if len(text) > MAX_TEXT:
        raise SummaryError(f'Pasted text is too long (maximum {MAX_TEXT:,} characters).')
    stripped = text.strip()
    if stripped.startswith('{'):
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            try:
                parsed = ast.literal_eval(stripped)
            except (ValueError, SyntaxError, MemoryError, RecursionError) as exc:
                raise SummaryError(f'Could not read pasted dictionary: {str(exc)[:120]}') from None
        return _parse_dictionary(parsed, codes)
    table = _read_delimited_table(text, codes)
    return table if table is not None else _parse_block_text(text, codes)


def _median_from_freq(pairs: list[tuple[float, int]], n: int) -> float:
    target1 = (n - 1) // 2  # zero-based positions
    target2 = n // 2
    values = []
    running = 0
    for score, freq in sorted(pairs):
        next_running = running + freq
        for target in (target1, target2):
            if running <= target < next_running:
                values.append(score)
        running = next_running
    if len(values) != 2:
        raise SummaryError('Internal error computing the weighted median.')
    return (values[0] + values[1]) / 2


def analyze_frequencies(*, items: dict | None = None, text: str | None = None,
                        scale_labels: dict[str, str] | None = None,
                        reversed: bool = False,
                        reverse_items: list[str] | None = None,
                        population_size: int | None = None,
                        sample_size: int | None = None,
                        sd_method: str = 'sample') -> dict[str, Any]:
    """Calculate itemwise weighted descriptors without creating respondent rows.

    ``items`` is a mapping of item -> category -> count. User-supplied totals can
    be entered as an inner ``total`` key; they must equal summed valid counts.
    """
    if not isinstance(reversed, bool):
        raise SummaryError('reversed must be true or false.')
    if sd_method not in ('sample', 'population'):
        raise SummaryError('Choose sample or population standard deviation.')
    for name, val in (('population_size', population_size), ('sample_size', sample_size)):
        if val is not None and (isinstance(val, bool) or not isinstance(val, int) or val < 1):
            raise SummaryError(f'{name} must be a positive whole number or blank.')
    if population_size is not None and sample_size is not None and sample_size > population_size:
        raise SummaryError('Sample-size metadata cannot be larger than population-size metadata.')
    codes = _codes(scale_labels or DEFAULT_LABELS)
    input_items = parse_summary_input(text, items, codes)
    if len(input_items) > MAX_ITEMS:
        raise SummaryError(f'Enter at most {MAX_ITEMS} items at once.')
    reverse_set = set(reverse_items or [])
    extra = reverse_set - set(input_items)
    if extra:
        raise SummaryError(f'Reverse-scoring requested for unknown item(s): {", ".join(sorted(extra))}.')
    x_values = [c[1] for c in codes]
    reversed_scores = {code: score for (code, _, _), score in zip(codes, x_values[::-1])}
    descriptors = []
    for item, record in input_items.items():
        if len(item) > 200:
            raise SummaryError('Item titles must be 200 characters or fewer.')
        raw = record['frequencies']
        if not raw:
            raise SummaryError(f'{item}: no response frequencies were supplied.')
        lookup = _lookup(codes)
        counts = {}
        for key, value in raw.items():
            target = lookup.get(_norm(key))
            if target is None:
                raise SummaryError(f'{item}: unknown category {key!r}.')
            if target in counts:
                raise SummaryError(f'{item}: duplicate response category.')
            counts[target] = _int_count(value, f'{item} / {key}')
        n = sum(counts.values())
        if n < 1:
            raise SummaryError(f'{item}: at least one frequency must be greater than zero.')
        if n > MAX_TOTAL:
            raise SummaryError(f'{item}: total count exceeds {MAX_TOTAL:,}.')
        declared = record.get('total')
        if declared is not None:
            declared = _int_count(declared, f'{item} declared total')
            if declared != n:
                raise SummaryError(f'{item}: supplied Total N={declared} but response counts sum to {n}. Correct the counts; use valid N as the per-item total and put the overall survey sample size in metadata.')
        is_reversed = bool(reversed) or bool(record.get('reversed', False) or (item in reverse_set))
        entries = []
        for code, x, label in codes:
            frequency = counts.get(code, 0)
            scored = reversed_scores[code] if is_reversed else x
            entries.append({'code': code, 'label': label, 'frequency': frequency,
                            'percentage': 100.0 * frequency / n, 'score': scored,
                            'fx': scored * frequency})
        fx_sum = math.fsum(e['fx'] for e in entries)
        mean = fx_sum / n
        deviations = [e['frequency'] * (e['score'] - mean) ** 2 for e in entries]
        squared_sum = math.fsum(deviations)
        denom = n - 1 if sd_method == 'sample' else n
        sd = math.sqrt(squared_sum / denom) if denom else None
        for e, squared in zip(entries, deviations):
            e['squared_term'] = squared
        most = max(e['frequency'] for e in entries)
        modes = [e for e in entries if e['frequency'] == most]
        # Zero-frequency categories can never be a mode because n>0.
        mode_codes = [e['score'] for e in modes]
        median = _median_from_freq([(e['score'], e['frequency']) for e in entries], n)
        top_labels = [e['label'] for e in modes]
        midpoint = (x_values[0] + x_values[-1]) / 2
        span = x_values[-1] - x_values[0]
        distance = mean - midpoint
        status = ('at the scale midpoint' if abs(distance) < 1e-10 else
                  ('slightly above' if distance > 0 and abs(distance) <= 0.15 * span else
                   'above' if distance > 0 else
                   'slightly below' if abs(distance) <= 0.15 * span else 'below') + ' the scale midpoint')
        mid_code = next((e['label'] for e in entries if abs(e['score'] - midpoint) < 1e-10), None)
        mid_name = f'{midpoint:g}' + (f' ({mid_code})' if mid_code else '')
        top_text = (' / '.join(top_labels) if len(top_labels) < 4 else f'{len(top_labels)} tied categories')
        notice = ('Scores were reverse-keyed (the response labels and frequencies shown remain original). '
                  if is_reversed else '')
        interpretation = (f'Mean {mean:.2f} is {status} ({mid_name}); '
                          f'most frequent response: {top_text} ({most}/{n}, {100 * most / n:.1f}%). '
                          + notice)
        descriptors.append({
            'item': item, 'n': n, 'mean': mean, 'sd': sd, 'sd_method': sd_method,
            'median': median, 'mode_scores': mode_codes,
            'mode': ' / '.join(f'{v:g}' for v in mode_codes),
            'top_response': top_text, 'top_frequency': most,
            'top_percentage': 100.0 * most / n,
            'reversed': is_reversed, 'table': entries,
            'interpretation': interpretation.strip(),
            'formula': {
                'mean': 'Σ(fᵢ × xᵢ) / Σfᵢ',
                'sd': '√[Σfᵢ(xᵢ − mean)² / (N − 1)]' if sd_method == 'sample'
                      else '√[Σfᵢ(xᵢ − mean)² / N]',
                'fx_sum': fx_sum, 'squared_sum': squared_sum, 'denominator': denom,
                'mean_working': ' + '.join(f'{e["frequency"]}×{e["score"]:g}' for e in entries),
            },
        })
    return {
        'title': 'Frequency-only descriptive statistics',
        'method': ('Sample SD divides by N−1 (Bessel correction), treating observed frequencies as a sample. '
                   'For N=1, sample SD is undefined.' if sd_method == 'sample' else
                   'Population SD divides by N; use only when these frequencies represent the entire population of interest.'),
        'metadata': {'population_size': population_size, 'sample_size': sample_size,
                     'metadata_only': True},
        'scale_labels': {code: label for code, _, label in codes},
        'items': descriptors,
        'summary': [{key: e[key] for key in ('item', 'n', 'mean', 'sd', 'mode', 'top_response')}
                    for e in descriptors],
        'limitations': LIMITATIONS,
        'notes': ['Totals are validated per item; population/sample metadata never changes denominators.',
                  'Counts and percentages always describe the original response categories.',
                  'Means, SD, mode codes and medians use the scoring direction selected for each item.',
                  'No respondent-level observations were generated or inferred.'],
    }


def summary_frame(result: dict) -> pd.DataFrame:
    """Convenience export from the already-computed per-item results."""
    return pd.DataFrame([{'Item': x['item'], 'N': x['n'], 'Mean': round(x['mean'], 4),
                          'SD': None if x['sd'] is None else round(x['sd'], 4),
                          'Mode (scored code)': x['mode'],
                          'Top response (original)': x['top_response']}
                         for x in result['items']])


def summary_csv(result: dict) -> str:
    """CSV export, protecting spreadsheet formula interpretation in text cells."""
    frame = summary_frame(result)
    for col in ('Item', 'Mode (scored code)', 'Top response (original)'):
        frame[col] = frame[col].map(lambda x: "'" + str(x) if re.match(r'^\s*[=+@\-\t\r]', str(x)) else str(x))
    return frame.to_csv(index=False)
