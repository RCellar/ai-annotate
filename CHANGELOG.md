# Changelog

## 0.2.0 (2026-04-05)

### Features

- **Model selection** — Optional setting to override the default Claude model (e.g., use Haiku for quick edits, Opus for complex rewrites). Passes `--model` to the CLI when set.
- **CLI availability check** — Plugin verifies the Claude CLI is reachable on load and shows a helpful Notice if not. Settings tab includes a "Test" button.
- **Fuzzy cursor matching** — "Process annotation at cursor" now finds the nearest `%%ai` marker if the cursor is within the target range or within 3 lines, instead of requiring exact placement on the marker.
- **Interleaved diff view** — Diff rendering now shows removes and adds adjacent at each change point instead of two separate blocks. Includes "−" / "+" prefixes for accessibility and a bordered card for visual clarity.
- **Friendly error messages** — Common CLI errors (not found, auth, rate limit, timeout) are mapped to actionable user messages instead of showing raw stderr.
- **Response sanitization** — Strips markdown fences and preamble text ("Here's the revised text:") from Claude responses before diffing.
- **Syntax reference in settings** — Settings tab heading explains the `%%ai` marker syntax for discoverability.

### Fixes

- `%%ai` markers inside fenced code blocks and inline code are no longer parsed as annotations.
- Accepting an inline `%%ai` marker that shares a line with other text no longer deletes the entire line.
- Plugin properly cleans up the review action handler on unload.
- Inline styles in the instruction modal moved to CSS class.
- Hover styles use Obsidian CSS variables instead of hardcoded `filter: brightness()`.
- System prompt textarea enlarged to 6 rows.

## 0.1.0 (2026-04-05)

Initial release.
