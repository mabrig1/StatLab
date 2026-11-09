"""Self-contained pandas script: per-item Likert statistics from frequency summaries.

Run: pip install pandas && python frequency_only_standalone.py
Edit FREQUENCIES and SCALE to use your own questionnaire counts and labels.
There are no respondent-level rows, reconstructed cases or inferential tests.
"""
from __future__ import annotations

import math
from pathlib import Path
import pandas as pd

# PASTE/EDIT FREQUENCY DICTIONARIES HERE — no individual rows needed.
FREQUENCIES = {
    'Item 5': {
        'Strongly Disagree': 30,
        'Disagree': 23,
        'Neutral': 20,
        'Agree': 45,
        'Strongly Agree': 35,
    },
    # 'Item 6': {'Strongly Disagree': 12, 'Disagree': 18, 'Neutral': 23,
    #            'Agree': 50, 'Strongly Agree': 40},
}
SCALE = {1: 'Strongly Disagree', 2: 'Disagree', 3: 'Neutral',
         4: 'Agree', 5: 'Strongly Agree'}
REVERSE_ITEMS = set()  # e.g. {'Item 6'}; use only for reverse-keyed questions
POPULATION_SIZE = None  # metadata only; does not enter formulas
SAMPLE_SIZE = 153       # metadata only; does not enter formulas
SD_METHOD = 'sample'    # 'sample' uses N−1; 'population' uses N


def summarize_frequency_items(frequencies: dict, scale: dict,
                              reverse_items: set | None = None,
                              sd_method: str = 'sample'):
    if sd_method not in ('sample', 'population'):
        raise ValueError('SD_METHOD must be sample or population.')
    ordered_codes = sorted(scale)
    if len(ordered_codes) < 2 or len(set(scale.values())) != len(scale):
        raise ValueError('Define at least 2 distinct response labels.')
    if not all(isinstance(k, (int, float)) and math.isfinite(k) for k in ordered_codes):
        raise ValueError('Scale codes must be finite numbers.')
    reverse_items = set(reverse_items or [])
    if not reverse_items.issubset(set(frequencies)):
        raise ValueError('REVERSE_ITEMS contains an unknown item.')
    summary = []
    for name, counts in frequencies.items():
        if not counts or set(counts).difference(scale.values()):
            raise ValueError(f'{name}: unknown categories or no frequencies.')
        if any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in counts.values()):
            raise ValueError(f'{name}: all frequencies must be non-negative integers.')
        rows = [{'Original code': code, 'Response': label,
                 'Frequency': counts.get(label, 0)} for code, label in sorted(scale.items())]
        table = pd.DataFrame(rows)
        n = int(table['Frequency'].sum())
        if n == 0:
            raise ValueError(f'{name}: all response counts are zero.')
        table['Percentage'] = 100 * table['Frequency'] / n
        scored_codes = list(reversed(ordered_codes)) if name in reverse_items else ordered_codes
        table['Scored code'] = scored_codes
        table['f × x'] = table['Frequency'] * table['Scored code']
        numerator = float(table['f × x'].sum())
        mean = numerator / n
        table['f(x − mean)²'] = table['Frequency'] * (table['Scored code'] - mean) ** 2
        ss = float(table['f(x − mean)²'].sum())
        denominator = (n - 1) if sd_method == 'sample' else n
        sd = math.sqrt(ss / denominator) if denominator > 0 else None
        # Weighted median from cumulative category counts — no case expansion.
        sorted_scores = table.sort_values('Scored code').copy()
        cumulative = sorted_scores['Frequency'].cumsum()
        def select_position(pos):
            return float(sorted_scores.loc[cumulative > pos, 'Scored code'].iloc[0])
        median = (select_position((n - 1) // 2) + select_position(n // 2)) / 2
        maximum = table['Frequency'].max()
        tops = table.loc[table['Frequency'] == maximum]
        mode = ' / '.join(f'{x:g}' for x in sorted(tops['Scored code'].tolist()))
        top_response = ' / '.join(tops['Response'])
        midpoint = (min(ordered_codes) + max(ordered_codes)) / 2
        direction = 'above' if mean > midpoint else 'below' if mean < midpoint else 'at'
        print(f'\n{name} · valid N = {n}')
        print(table.to_string(index=False, float_format=lambda v: f'{v:.3f}'))
        print(f'Mean = Σ(f×x) / Σf = {numerator:g} / {n} = {mean:.4f}')
        print(f'{sd_method.title()} SD = √(Σf(x−mean)² / {denominator}) '
              f'= √({ss:.4f}/{denominator}) = {sd:.4f}' if sd is not None
              else 'Sample SD undefined for N=1.')
        print(f'Median: {median:g}; Mode: {mode}; top response: {top_response}')
        print(f'Interpretation: mean {mean:.2f} is {direction} the scale midpoint '
              f'({midpoint:g}); most frequent response: {top_response} ({maximum}/{n}).')
        summary.append({'Item': name, 'N': n, 'Mean': round(mean, 4),
                        'SD': round(sd, 4) if sd is not None else None,
                        'Mode': mode, 'Top response': top_response})
    result = pd.DataFrame(summary)
    print('\nCOMBINED SUMMARY\n' + result.to_string(index=False))
    print('\nLIMITATIONS: Frequency-only inputs cannot establish respondent-level '
          'pairing. Correlations, regression, t-tests, ANOVA and Cronbach alpha '
          'cannot be computed from separate marginal distributions. '
          'Population/sample metadata do not recover original cases. '
          'Likert means assume approximately equally spaced numeric codes.')
    return result


if __name__ == '__main__':
    if SAMPLE_SIZE is not None and POPULATION_SIZE is not None and SAMPLE_SIZE > POPULATION_SIZE:
        raise ValueError('SAMPLE_SIZE metadata exceeds POPULATION_SIZE metadata.')
    combined = summarize_frequency_items(FREQUENCIES, SCALE, REVERSE_ITEMS, SD_METHOD)
    path = Path('frequency_only_summary.csv')
    # Prevent spreadsheet formula execution from user-defined item labels.
    for col in ('Item', 'Mode', 'Top response'):
        combined[col] = combined[col].astype(str).map(
            lambda s: "'"+s if s.lstrip().startswith(('=', '+', '-', '@')) else s)
    combined.to_csv(path, index=False)
    print(f'\nExported: {path.resolve()}')
