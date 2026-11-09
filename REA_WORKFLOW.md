# REA-based functional investigation — without proprietary copying

**Reference repository:** https://github.com/morluto/rea — `rea-agents` (MIT), the REA **Reverse Engineer Anything** MCP/CLI. At the time of inspection, `morluto/rea` README describes binary, desktop, JavaScript/Electron and website observation tools with evidence and limitations; its setup currently needs Node 22.23.4+, 24.22.1+ or 26.12.1+.

**Purpose:** guide a legitimate clean-room *functional* comparison between documented user workflows in statistical programs (SPSS, jamovi, JASP, PSPP) and the MABRIG StatLab implementation. REA is for understanding permitted behaviors; all math and UI are implemented independently with SciPy and Statsmodels.

## Setup on a compatible, trusted workstation

1. Check Node version using `node --version` against REA's documented Node engines.
2. Obtain REA only from `morluto/rea` / `rea.tools` / `rea-agents` on npm; review license/dependencies and pin a known-good release.
3. Run `npx rea-agents setup` and approve agent configuration changes after inspecting them. Or use the CLI documented in REA README.
4. Prefer investigating an **open-source statistical app** (e.g. jamovi or PSPP) or public documentation and authorized browser interactions. Do not attempt to extract IBM proprietary source, bypass license checks, or reuse IBM-owned interface assets.
5. For an authorized local JS/Electron application, REA documents `npx -y rea-agents@<pinned-version> analyze-javascript-application /absolute/path/to/app --json`. Supply the actual local target and pin the version after testing on your environment.
6. Record **observable behavior** (input types, variable coding, missing-value conventions, menu steps, analytical outputs, export format) together with tool evidence, confidence and known unknowns. Compare this with clean reference calculations and our test corpus.

## Current implementation status

The REA repository's README, package engine requirements and LICENSE were reviewed via GitHub on 2026-11-09. **REA CLI has not been executed** on any target: this build environment has Node 22.16.0, below REA's supported engine versions, and contains no authorized local SPSS/jamovi installation. No binary disassembly, hidden proprietary source extraction or SPSS UI cloning was performed. This repository incorporates the reference's **evidence-first workflow**, not REA runtime functionality.

## Target analysis questions for a future REA-assisted audit

- How do variable view and data view represent types, value labels, user-missing codes and transformations?
- Which exact settings produce Welch vs equal-variance t-tests, Pearson vs Spearman, and listwise vs pairwise deletion?
- Does the result reporter provide sufficient method/assumption warnings and dataset provenance?
- Can each statistic be independently reproduced and tied back to a fixture and data fingerprint?

## Compliance boundaries

- Reimplement public statistical methods; do not copy source/assets or bypass software restrictions.
- Never transmit sensitive respondent data to an untrusted analysis service.
- Document math conventions, test versions and numeric tolerance in regression tests.
