# Contributing

Thanks for looking. This is a small, opinionated project: an honest local meter for what AI
coding agents cost you. Contributions are welcome, especially the ones listed under
[What is most wanted](#what-is-most-wanted).

*This file is in English; the project's README is available in
[English](README.md) and [Español](README.es.md).*

## Getting set up

```bash
git clone https://github.com/ASanchezT85/agent-engine.git
cd agent-engine
bun test        # 30 tests, no setup needed
bun run serve   # dashboard on http://127.0.0.1:4823
```

There is **no install step**: the project has zero dependencies and Bun ships everything it
uses. If your change needs a dependency, say why in the PR — it will be weighed against
writing the few lines by hand.

Useful while developing:

```bash
ENGINE_DB=/tmp/demo.db bun run serve   # point the Engine at a throwaway database
bun run detect                         # what it finds on your machine, touching nothing
bun run audit                          # read-only guard + recommendations
```

## The rules that are not up for negotiation

These are what the project *is*. A PR that breaks one of them will not be merged, however good
the feature is.

**1. Never write into a tool's folder.** `~/.claude`, `~/.codex`, `~/.cursor`, `~/.opencode`
and anything like them are strictly read-only. Go through `src/core/paths.ts`, use
`openReadOnly()` / `assertReadOnly()`, and if a database can only be read by copying it, copy
it into `data/` and read the copy — that is what the Cursor adapter does.

**2. Never invent a number.** If a rate is unknown, it is `UNVERIFIED` and the cost is 0, shown
as a warning. If a tool does not record tokens, its numbers stay out of the money figures. If a
PID cannot be matched to a session, the UI says so instead of guessing. An empty cell is
information; a plausible fabrication is a bug that nobody will catch.

**3. Rates come from the vendor's own page, with a date.** They live only in
`config/pricing.json`, never in code. When you add or change one, update `verifiedAt` and make
sure the URL in `sources` is the page you actually read.

**4. Free text gets redacted.** Anything that comes out of a transcript, a title, a memory file
or a commit message goes through `redact()` before it is stored or served.

**5. The backend sends no prose.** Provider notes and recommendations travel as a translation
key plus numbers; the front-end turns them into text. This keeps presentation out of the
backend and translations in one place.

**6. Both languages, always.** Every user-facing string lives in `web/i18n.js` under `es` and
`en`. Four tests enforce it: same keys in both, every key used by `app.js` exists, provider and
recommendation keys are complete, and `{{params}}` match across languages.

## Tests

`bun test` must pass. Non-trivial logic ships with a test — parsers, cost maths, filters,
anything that could silently drift.

The tests that matter most are the ones pinning **invariants**, not implementation details.
For example: *the export must sum to exactly what the dashboard shows for the same filter*.
That one caught a real bug where a session merely grazing the date range dragged its whole cost
in. If your change touches measurement, add the invariant that would have caught you.

Tests must not depend on any AI tool being installed: use temporary directories and fixtures,
like the existing Codex and OpenCode tests do.

## Adding a provider

Implement the `Provider` interface in `src/core/types.ts`:

```ts
export const myProvider: Provider = {
  id: "mytool",
  label: "My Tool",
  detect() { /* { installed, root, note: "i18n.key", noteParams } */ },
  index(db) { /* returns { files, newBytes, messages } */ },
};
```

Register it in `src/providers/registry.ts`, add its strings to `web/i18n.js`, and honour the
freshness gate: skip a file whose `size` and `mtime` have not changed. Read incrementally
where the format allows it (`src/core/jsonl.ts` does the offset bookkeeping).

Before writing the parser, **read the tool's source** to confirm the format instead of guessing
from a sample. Both the Codex and OpenCode adapters were written that way, and the file headers
cite the exact files that were read. If you cannot verify it, say so in the code and in the
README rather than implying it is tested.

## Reporting a bug

Please include:

- your OS and `bun --version`;
- the output of `bun run detect`;
- the version of the tool whose data is misread.

**Do not paste transcripts, session titles or full project paths.** They are exactly the kind of
thing this project goes out of its way not to publish. A redacted snippet of the offending
line is plenty.

## What is most wanted

- **Cursor paths on macOS and Linux.** The adapter currently assumes the Windows
  `AppData/Roaming` location; it is the only thing tying this project to Windows.
- **Confirming the Codex and OpenCode adapters against real installations.** They were written
  against the verified format and covered by fixtures, but never run on real data.
- **New or corrected rates** in `config/pricing.json`.
- **A provider for another agent** — Aider, Cline, Copilot CLI, anything that leaves usable
  traces on disk.

## Style

TypeScript with `strict` on. Comments explain *why*, not *what* — and the ones worth writing
are the traps: the field that lies, the number that is cumulative, the join that silently
double-counts. Keep the diff small and boring.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
