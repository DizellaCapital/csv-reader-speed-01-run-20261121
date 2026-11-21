[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed-01-run-20261121

A fast drop-in replacement for **csv-reader 1.0.0** — it reads broken CSV
files exactly the way csv-reader does, only faster.

`solve.js` (dependency-free ES module, `run(input)` → `{columns, rows,
errors}`) is a single-pass parser written from the bounty spec: BOM dropped,
records end at LF/CRLF, empty lines are no records, lone CRs outside quotes
are dropped (`stray_cr`), quoted fields handle `""`, CRLF/lone CR inside
quotes (read as LF), trailing junk after the closing quote (`quote_junk`),
and quotes that never close (literal + re-read as unquoted,
`unterminated_quote`); rows are padded (`short_row`) or cut (`long_row`) to
the first record's width, with errors reported as `{code, line, row}` in the
order met.

Speed comes from `indexOf`/`charCodeAt` scanning instead of character-at-a-
time reads, single `slice`s per field in the common case, cached next-CR /
next-LF positions so no scan re-walks ground already covered, and minimal
allocation. `main.ts` is the harness driver: it reads `/input/cases.json`,
answers each case with `run`, and writes `/output/answers.json`.

Verified locally against the practice set in the kit (all 6 cases identical
to the reference) plus hand-built cases for every error code (`stray_cr`,
`quote_junk`, `unterminated_quote`, `short_row`, `long_row`), BOM, CRLF,
doubled quotes, empty fields, and `header` true/false.

Entry for the [make.fun bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
"Read broken CSV files faster, 21 November 2026" — $100, top 10 paid $10 each.
