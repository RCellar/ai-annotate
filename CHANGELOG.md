# Changelog

## 0.2.0 (2026-04-06)

### Features

- **Model selection** — Optional setting to override the default Claude model (e.g., use Haiku for quick edits, Opus for complex rewrites). Passes `--model` to the CLI when set.
- **CLI availability check** — Plugin verifies the Claude CLI is reachable on load and shows a helpful Notice if not. Settings tab includes a "Test" button.
- **Fuzzy cursor matching** — "Process annotation at cursor" now finds the nearest `%%ai` marker if the cursor is within the target range or within 3 lines, instead of requiring exact placement on the marker.
- **Interleaved diff view** — Diff rendering now shows removes and adds adjacent at each change point instead of two separate blocks. Includes "−" / "+" prefixes for accessibility and a bordered card for visual clarity.
- **Friendly error messages** — Common CLI errors (not found, auth, rate limit, timeout) are mapped to actionable user messages instead of showing raw stderr.
- **Response sanitization** — Strips markdown fences and preamble text ("Here's the revised text:") from Claude responses before diffing.
- **Syntax reference in settings** — Settings tab heading explains the `%%ai` marker syntax for discoverability.
- **Context strategy** — New "Context sent to claude" setting controls how much of the document is included in each prompt: full document, target section only, or section ± neighbors (default). Reduces token cost for large notes.
- **Extra CLI arguments** — New setting to pass additional arguments to the spawned Claude process (e.g., `--max-turns 5`).
- **Environment variables** — New setting to define environment variables (one KEY=VALUE per line) merged into the CLI process environment.
- **CLI reference link** — Advanced settings section links to the Claude CLI reference documentation.

### Fixes

- `%%ai` markers inside fenced code blocks and inline code are no longer parsed as annotations.
- Accepting an inline `%%ai` marker that shares a line with other text no longer deletes the entire line.
- Plugin properly cleans up the review action handler on unload.
- Inline styles in the instruction modal moved to CSS class.
- Hover styles use Obsidian CSS variables instead of hardcoded `filter: brightness()`.
- System prompt textarea enlarged to 6 rows.
- Diff engine now uses index pairs from LCS, fixing incorrect output when duplicate tokens appear in the text.
- Concurrent annotation processing is now guarded — running multiple commands simultaneously no longer creates duplicate decorations.
- Offset adjustment after accepting an annotation uses `>=` instead of `>`, fixing misaligned annotations at the same start position.
- Neighbors context strategy correctly handles targets before the first heading.
- Plugin cancels all in-flight Claude processes on unload, preventing orphaned child processes.
- Diff decorations are mapped through document changes, preventing position drift when editing during review.
- Marker deletion on the last line of a document no longer produces incorrect range calculations.
- Cancelling an annotation no longer shows a spurious error Notice.
- Fenced code block detection uses a line scanner instead of a backtracking regex, improving performance on documents with unclosed fences.
- Fence-stripping in response sanitization handles responses without a trailing newline before the closing fence.
- `<!-- TARGET END -->` delimiter is always emitted, even when the target range extends to the end of the document.
- Selection-based annotations now respect the processing guard, preventing concurrent CLI invocations.
- Test CLI button no longer shows a duplicate Notice when the binary is not found.
- Marker regex is no longer shared across calls, eliminating a potential state corruption hazard.
- Large diffs (>250K token pairs) fall back to a full replacement view instead of freezing the UI.
- UI text follows Obsidian sentence case conventions.
- Floating promises are properly handled with `void` operator.
- Removed unnecessary type assertion in internal CodeMirror view accessor.
- `%%ai` markers inside unclosed fenced code blocks are now suppressed, matching Obsidian's own rendering behaviour.
- Claude CLI path setting falls back to the default when cleared to an empty string.
- Diff decorations with collapsed ranges (e.g., target deleted during review) are filtered out, preventing orphaned review buttons.
- Decoration sort includes `startSide`, preventing a CM6 crash when multiple annotations share the same position.
- Processing an annotation with no target text (e.g., `%%ai` immediately after a heading) now shows a notice instead of sending a degenerate prompt.
- Batch processing: `originalText` is re-read from the live document after earlier accepts, so the diff display matches current content.

## 0.1.0 (2026-04-05)

Initial release.
