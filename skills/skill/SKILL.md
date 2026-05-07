---
name: skill
description: Manage local skills - list, add, remove, search, edit, setup wizard
argument-hint: "<command> [args]"
---

# Skill Management

Meta-skill for managing oh-my-ghcopilot skills via CLI-like commands.

## Subcommands

### /skill list

Show all local skills organized by scope.

**Behavior:**
1. Scan user skills at `~/.copilot/skills/`
2. Scan project skills at `<project>/.copilot/skills/`
3. Parse YAML frontmatter for metadata
4. Display in organized table format:

```
USER SKILLS (~/.copilot/skills/):
| Name              | Triggers           | Scope |
|-------------------|--------------------|-------|
| error-handler     | fix, error         | user  |
| api-builder       | api, endpoint      | user  |

PROJECT SKILLS (<project>/.copilot/skills/):
| Name              | Triggers           | Scope   |
|-------------------|--------------------|---------|
| test-runner       | test, run          | project |
```

For the **bundled** OMGHC skills (the 35 packaged with the npm distribution), use `omghc list --json` instead — that reads the catalog directly.

---

### /skill add [name]

Interactive wizard for creating a new skill.

**Behavior:**
1. **Ask for skill name** (if not provided in command)
   - Validate: lowercase, hyphens only, no spaces
2. **Ask for description**
   - Clear, concise one-liner
3. **Ask for triggers** (comma-separated keywords)
   - Example: "error, fix, debug"
4. **Ask for argument hint** (optional)
   - Example: "<file> [options]"
5. **Ask for scope:**
   - `user` → `~/.copilot/skills/<name>/SKILL.md`
   - `project` → `<project>/.copilot/skills/<name>/SKILL.md`
6. **Create skill file** with template:

```yaml
---
name: <name>
description: <description>
triggers:
  - <trigger1>
  - <trigger2>
argument-hint: "<args>"
---

# <Name> Skill

## Purpose

[Describe what this skill does]

## When to Activate

[Describe triggers and conditions]

## Workflow

1. [Step 1]
2. [Step 2]
3. [Step 3]

## Examples

```
/<name> example-arg
```

## Notes

[Additional context, edge cases, gotchas]
```

7. **Report success** with file path
8. **Suggest:** "Edit `/skill edit <name>` to customize content"

---

### /skill remove <name>

Remove a skill by name.

**Behavior:**
1. **Search for skill** in both scopes:
   - `~/.copilot/skills/<name>/SKILL.md`
   - `<project>/.copilot/skills/<name>/SKILL.md`
2. **If found:**
   - Display skill info (name, description, scope)
   - **Ask for confirmation:** "Delete '<name>' skill from <scope>? (yes/no)"
3. **If confirmed:**
   - Delete entire skill directory (e.g., `~/.copilot/skills/<name>/`)
   - Report: "✓ Removed skill '<name>' from <scope>"
4. **If not found:**
   - Report: "✗ Skill '<name>' not found in user or project scope"

**Safety:** Never delete without explicit user confirmation.

---

### /skill edit <name>

Edit an existing skill interactively.

**Behavior:**
1. **Find skill** by name (search both scopes)
2. **Read current content** via Read tool
3. **Display current values** (description, triggers, argument-hint, scope)
4. **Ask what to change:**
   - `description`, `triggers`, `argument-hint`, `content`, `rename`, `cancel`
5. **For selected field:**
   - Show current value
   - Ask for new value
   - Update YAML frontmatter or content
   - Write back to file
6. **Report success** with summary of changes

---

### /skill search <query>

Search skills by content, triggers, name, or description.

**Behavior:**
1. **Scan all skills** in both scopes
2. **Match query** (case-insensitive) against:
   - Skill name
   - Description
   - Triggers
   - Full markdown content
3. **Display matches** with context — prioritize matches in name/triggers over content matches.

---

### /skill info <name>

Show detailed information about a skill.

**Behavior:**
1. **Find skill** by name (search both scopes)
2. **Parse YAML frontmatter** and content
3. **Display complete details** (name, scope, description, triggers, argument hint, file path, full content)

---

### /skill sync

Sync skills between user and project scopes.

**Behavior:**
1. **Scan both scopes**
2. **Compare and categorize:** user-only, project-only, common
3. **Display sync opportunities** with options to copy in either direction or view diffs
4. **Never overwrite without confirmation**

---

### /skill setup

Interactive wizard for setting up and managing local skills.

**Behavior:**

#### Step 1: Directory check + setup

```bash
USER_SKILLS_DIR="$HOME/.copilot/skills"
[ -d "$USER_SKILLS_DIR" ] || mkdir -p "$USER_SKILLS_DIR"

PROJECT_SKILLS_DIR=".copilot/skills"
[ -d "$PROJECT_SKILLS_DIR" ] || mkdir -p "$PROJECT_SKILLS_DIR"
```

#### Step 2: Scan + inventory

Scan both directories and show a comprehensive inventory of name, description, modified-time per skill.

#### Step 3: Quick actions menu

Use AskUserQuestion to offer:

1. **Add new skill** — `/skill add`
2. **List all skills with details** — `/skill list`
3. **Scan conversation for patterns** — analyze recent debugging or workflow patterns; ask if any should be extracted as skills
4. **Import skill** — from URL or pasted content; pick scope (user/project)
5. **Done** — exit

---

### /skill scan

Subset of `/skill setup` Step 2 — non-interactive scan only.

---

## Skill Templates

When creating skills via `/skill add` or `/skill setup`, offer quick templates for common skill types: error solution, workflow, code pattern, integration. Each template uses YAML frontmatter (`name`, `description`, `triggers`) and standardized sections (Purpose / Recognition Pattern / Approach / Example / Gotchas).

---

## Error Handling

**All commands must handle:**
- File/directory doesn't exist
- Permission errors
- Invalid YAML frontmatter
- Duplicate skill names
- Invalid skill names (spaces, special chars)

**Error format:**

```
✗ Error: <clear message>
→ Suggestion: <helpful next step>
```

---

## Usage Modes

### Direct command mode

When invoked with an argument, skip the interactive wizard:

- `/skill list` — show inventory
- `/skill add` — start creation wizard
- `/skill scan` — scan both directories

### Interactive mode

When invoked without arguments, run the full guided wizard.

---

## Skill Quality Guidelines

Good skills are:

1. **Non-Googleable** — can't easily find via search.
2. **Context-Specific** — references actual files/errors from THIS codebase.
3. **Actionable with Precision** — tells exactly WHAT to do and WHERE.
4. **Hard-Won** — required significant debugging effort.

---

## Related Skills

- `/note` — save quick notes (less formal than skills)

---

## Implementation Notes

1. **YAML Parsing:** use frontmatter extraction for metadata.
2. **File Operations:** Read/Write tools for new files; never use Edit on a file you haven't Read.
3. **User Confirmation:** always confirm destructive operations.
4. **Clear Feedback:** use checkmarks (✓), crosses (✗), arrows (→) for clarity.
5. **Scope Resolution:** always check both user and project scopes.
6. **Validation:** enforce naming conventions (lowercase, hyphens only).
