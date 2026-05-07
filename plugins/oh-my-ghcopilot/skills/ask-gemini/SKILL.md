---
name: ask-gemini
description: Ask Gemini via local CLI and capture a reusable artifact
---

# Ask Gemini (Local CLI)

Use the locally installed Gemini CLI as a direct external advisor for brainstorming, design feedback, and second opinions.

## Usage

```
/ask-gemini <question or task>
```

## Routing

### Preferred: Local CLI execution
Invoke the Gemini CLI directly from a shell tool with non-interactive flags:

```bash
gemini -p "{{ARGUMENTS}}"
# equivalent: gemini --prompt "{{ARGUMENTS}}"
```

If needed, adapt to the user's installed Gemini CLI variant while keeping local execution as the default path.

### Missing binary behavior
If `gemini` is not found:
1. Explain that local Gemini CLI is required for this skill.
2. Ask the user to install/configure Gemini CLI.
3. Provide a quick verification command:

```bash
gemini --version
```

Do not silently fall back to another model — the user invoked this skill specifically to consult Gemini.

## Artifact requirement
After local execution, save a markdown artifact to:

```text
.omghc/artifacts/gemini-<slug>-<timestamp>.md
```

Minimum artifact sections:
1. Original user task
2. Final prompt sent to Gemini CLI
3. Gemini output (raw)
4. Concise summary
5. Action items / next steps

Task: {{ARGUMENTS}}
