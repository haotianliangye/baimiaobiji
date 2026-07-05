# Project: theme-superhuman branch review

## Architecture & System Context
We are conducting a dual-axis (standards and requirements) review of the `theme-superhuman` branch compared to the `main` branch. The codebase is a React application with an Express backend, using Tailwind CSS and IndexedDB.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Diff Analysis & Exploration | Determine the exact diff between main and theme-superhuman. Identify all file changes and code changes relevant to the UI, layout, colors, and constraints. | none | DONE (output: d:\baimiaobiji\.agents\explorer_m1\handoff.md) |
| 2 | Code Verification & Checkup | Verify specific requirements: Title font/translate classes, bubble card transform removal, recording bar gradient classes, setting page cards upgrade to `.baimiao-card-diary`, and bottom buttons styling. | M1 | IN_PROGRESS |
| 3 | Standards Compliance Audit | Verify that body/root container overflow: hidden and overscroll-behavior: none are preserved, and that "baimiao" naming conventions are respected (no translation to whitewash). | M1 | DONE (output: d:\baimiaobiji\.agents\auditor_1\handoff.md) |
| 4 | Synthesis & Handoff Report | Consolidate the findings from subagents, check build/test outcomes, and construct the final report. | M2, M3 | PLANNED |

## Interface & Quality Contracts
- All findings must be backed by file paths, lines of code, and exact diff content.
- Verification must ensure no compilation or TypeScript errors.
