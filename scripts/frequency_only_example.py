"""MABRIG StatLab — frequency-only Likert analysis demonstration.

RUN: python scripts/frequency_only_example.py
REQUIREMENT: pip install pandas

Edit FREQUENCIES and SCALE_LABELS below. No person-by-person rows are needed
or generated. This script uses only frequency counts in a pasted dictionary.
"""
from pathlib import Path
import sys

import pandas as pd

# Permit direct invocation from the repository scripts/ directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.aggregate_descriptives import analyze_frequencies, summary_frame, summary_csv

# Edit this dictionary or paste your own dictionary of item frequency counts.
FREQUENCIES = {
    "Item 5": {
        "Strongly Disagree": 30,
        "Disagree": 23,
        "Neutral": 20,
        "Agree": 45,
        "Strongly Agree": 35,
        "total": 153,  # Optional: checked against the sum of counts.
    },
    # Uncomment and edit to calculate several items in a single run.
    # "Item 6": {"1": 14, "2": 18, "3": 26, "4": 49, "5": 46},
}

# Scale codes can be changed; e.g. 0–4 or a three-point scale.
SCALE_LABELS = {
    "1": "Strongly Disagree",
    "2": "Disagree",
    "3": "Neutral",
    "4": "Agree",
    "5": "Strongly Agree",
}


def main() -> None:
    output = analyze_frequencies(
        items=FREQUENCIES,
        scale_labels=SCALE_LABELS,
        sd_method="sample",           # Default: divides by valid N − 1.
        reversed=False,             # Set True to reverse all the items.
        reverse_items=[],           # e.g. ["Item 6"] only, if negatively worded.
        population_size=None,       # Optional; reference only.
        sample_size=None,           # Optional; reference only.
    )
    for item in output["items"]:
        print(f"\n{'=' * 62}\n{item['item']} | Valid N={item['n']}")
        print(pd.DataFrame(item["table"])[["code", "label", "frequency", "percentage", "score"]]
              .rename(columns={"code": "Code", "label": "Response", "frequency": "Count",
                               "percentage": "Percent", "score": "Scored x"})
              .to_string(index=False, float_format=lambda x: f"{x:.2f}"))
        print(f"\nMean = {item['formula']['fx_sum']:.4f} / {item['n']} = {item['mean']:.4f}")
        sd_text = (f"√({item['formula']['squared_sum']:.4f} / {item['formula']['denominator']})"
                   f" = {item['sd']:.4f}") if item['sd'] is not None else 'undefined (N=1)'
        print(f"Sample SD = {sd_text}")
        print(f"Mode = {item['mode']} | Median = {item['median']:g}")
        print(f"Interpretation: {item['interpretation']}")

    print("\nCOMBINED SUMMARY")
    print(summary_frame(output).to_string(index=False))
    print("\nLIMITATIONS\n" + output['limitations'])
    path = Path.cwd() / 'frequency_only_summary.csv'
    path.write_text(summary_csv(output), encoding='utf-8-sig')
    print(f"\nCSV saved: {path}")


if __name__ == '__main__':
    main()
