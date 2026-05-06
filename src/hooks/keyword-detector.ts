/**
 * Keyword Detection Engine for OMGHC.
 *
 * Detects workflow-activation keywords like `$ralph`, `$team`, `$ralplan`,
 * `$deep-interview`, `$autopilot`, `$ultrawork`, `$ultraqa` from a user prompt.
 *
 * Wired to `userPromptSubmitted` events by `src/scripts/copilot-native-hook.ts`.
 *
 * Forward-compat note: file-based hooks DO NOT FIRE in Copilot CLI v1.0.40
 * (see docs/copilot-native-hooks.md). Tests exercise this module directly.
 *
 * Behavior ported from oh-my-codex@0.15.1 (`src/hooks/keyword-detector.ts`):
 * - `$<keyword>` activation at word boundary (case-insensitive).
 * - Korean 2-set IME drift (`ㅕㅣㅈ` → `ulw`) per OMX 0.14.2 changelog.
 * - Casual prose mention of `ralph`/`team`/etc. without `$` prefix MUST NOT
 *   activate (per OMX 0.13.2 PR #1697).
 * - Casual prose mention of `deep interview` without `$` prefix MUST NOT
 *   activate (per OMX 0.14.2).
 * - "Activation phrases" (e.g. `start ralph`, `run a team`) DO activate, but
 *   "I was talking about ralph" does not.
 */

export type KeywordIntent =
  | "ralph"
  | "team"
  | "ralplan"
  | "deep-interview"
  | "autopilot"
  | "ultrawork"
  | "ultraqa"
  | "skill-active"
  | null;

export interface DetectionResult {
  intent: KeywordIntent;
  rawKeyword: string | null;
  confidence: "high" | "medium" | "low";
  reasoning?: string;
}

interface KeywordDefinition {
  intent: Exclude<KeywordIntent, null | "skill-active">;
  /** Canonical `$keyword` literal (lowercase, leading `$`). */
  explicit: string;
  /** Aliases that count as an explicit `$alias` invocation. */
  aliases: string[];
  /** Activation phrase patterns (no `$` prefix). */
  activationPatterns: RegExp[];
  /** Priority: lower = higher priority when multiple intents match. */
  priority: number;
}

const KEYWORD_DEFINITIONS: KeywordDefinition[] = [
  {
    intent: "deep-interview",
    explicit: "$deep-interview",
    aliases: [],
    activationPatterns: [
      /\b(?:use|run|start|enable|launch|invoke|activate|do|begin)\s+(?:a\s+|an\s+|the\s+)?deep(?:[- ]+)interview\b/i,
      /^(?:please\s+)?deep(?:[- ]+)interview\b/i,
      /\bdeep(?:[- ]+)interview\s+(?:this|first|before|me|now)\b/i,
      /\binterview\s+(?:me|this|the\s+(?:request|task|problem))\b/i,
    ],
    priority: 0,
  },
  {
    intent: "ralplan",
    explicit: "$ralplan",
    aliases: [],
    activationPatterns: [
      /\b(?:use|run|start|enable|launch|invoke|activate)\s+(?:a\s+|an\s+|the\s+)?ralplan\b/i,
      /\bralplan\s+(?:mode|workflow|first|this)\b/i,
    ],
    priority: 1,
  },
  {
    intent: "autopilot",
    explicit: "$autopilot",
    aliases: [],
    activationPatterns: [
      /\b(?:use|run|start|enable|launch|invoke|activate|engage)\s+(?:a\s+|an\s+|the\s+)?autopilot\b/i,
      /\bautopilot\s+(?:mode|workflow)\b/i,
    ],
    priority: 2,
  },
  {
    intent: "ralph",
    explicit: "$ralph",
    aliases: [],
    activationPatterns: [
      /\b(?:use|run|start|enable|launch|invoke|activate|resume|continue)\s+(?:a\s+|an\s+|the\s+)?ralph\b/i,
      /^(?:please\s+)?ralph\s+(?:continue|resume|start|run|go|keep\s+going|ship|fix|implement|execute|verify|complete)\b/i,
      /\bralph\s+(?:mode|workflow|loop)\b/i,
    ],
    priority: 3,
  },
  {
    intent: "team",
    explicit: "$team",
    aliases: ["$swarm"],
    activationPatterns: [
      /\b(?:use|run|start|enable|launch|invoke|activate|orchestrate|coordinate)\s+(?:a\s+|an\s+|the\s+)?team\b/i,
      /\bteam\s+(?:mode|orchestration|workflow|agents?)\b/i,
    ],
    priority: 4,
  },
  {
    intent: "ultrawork",
    explicit: "$ultrawork",
    aliases: ["$ulw", "$parallel"],
    activationPatterns: [
      /\b(?:use|run|enable|start|activate|launch)\s+(?:in\s+)?parallel\b/i,
      /\bultrawork\b/i,
      /\bulw\b/i,
      /\bparallel\s+(?:mode|execution|workers?|agents?|tasks?)\b/i,
      /\brun\s+(?:tasks?|agents?|workers?)\s+in\s+parallel\b/i,
    ],
    priority: 5,
  },
  {
    intent: "ultraqa",
    explicit: "$ultraqa",
    aliases: [],
    activationPatterns: [
      /\b(?:use|run|start|enable|launch|invoke|activate)\s+(?:a\s+|an\s+|the\s+)?ultraqa\b/i,
      /\bultraqa\s+(?:mode|workflow|cycle)\b/i,
    ],
    priority: 6,
  },
];

/**
 * Korean 2-set keyboard typo aliases.
 *
 * Keep this intentionally narrow: only the `ulw` (ultrawork) shorthand is
 * normalized so users who forget to switch IMEs get the same activation path
 * as the canonical keyword. Don't expand without a concrete user report.
 */
function normalizeWorkflowKeyboardTypos(text: string): string {
  return text.replace(/ㅕㅣㅈ/g, "ulw");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ExplicitMatch {
  intent: Exclude<KeywordIntent, null | "skill-active">;
  rawKeyword: string;
  priority: number;
}

/**
 * Find an explicit `$keyword` (or known alias) in the text. Returns the first
 * match in left-to-right order, normalized to its canonical intent.
 */
function findExplicitInvocation(text: string): ExplicitMatch | null {
  const candidates: Array<{ match: RegExpMatchArray; def: KeywordDefinition; raw: string }> = [];

  for (const def of KEYWORD_DEFINITIONS) {
    const tokens = [def.explicit, ...def.aliases];
    for (const token of tokens) {
      const escaped = escapeRegex(token);
      const re = new RegExp(`(?:^|[^\\w])${escaped}\\b`, "i");
      const m = text.match(re);
      if (m && m.index !== undefined) {
        const tokenStart = m.index + m[0].lastIndexOf("$");
        candidates.push({
          match: { ...m, index: tokenStart } as RegExpMatchArray,
          def,
          raw: token.toLowerCase(),
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const ai = a.match.index ?? 0;
    const bi = b.match.index ?? 0;
    if (ai !== bi) return ai - bi;
    return a.def.priority - b.def.priority;
  });

  const top = candidates[0];
  return {
    intent: top.def.intent,
    rawKeyword: top.raw,
    priority: top.def.priority,
  };
}

/**
 * Find an "activation phrase" match (no `$` prefix). Used as a medium-confidence
 * fallback. Casual prose mentions like "I was talking about ralph" do not match
 * any of these patterns.
 */
function findActivationPhrase(
  text: string,
): { intent: Exclude<KeywordIntent, null | "skill-active">; rawKeyword: string; priority: number } | null {
  const matches: Array<{
    intent: Exclude<KeywordIntent, null | "skill-active">;
    rawKeyword: string;
    priority: number;
    index: number;
  }> = [];

  for (const def of KEYWORD_DEFINITIONS) {
    for (const pattern of def.activationPatterns) {
      const m = text.match(pattern);
      if (m && m.index !== undefined) {
        matches.push({
          intent: def.intent,
          rawKeyword: m[0].trim().toLowerCase(),
          priority: def.priority,
          index: m.index,
        });
        break;
      }
    }
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.index - b.index;
  });

  const top = matches[0];
  return {
    intent: top.intent,
    rawKeyword: top.rawKeyword,
    priority: top.priority,
  };
}

/**
 * Detect a single workflow keyword in the user prompt.
 *
 * Resolution order:
 *   1. Explicit `$keyword` (or known alias) → high confidence.
 *   2. Activation phrase (e.g. "start ralph", "run a team") → medium confidence.
 *   3. Otherwise → null intent, low confidence.
 *
 * Casual prose mentions of keywords without `$` prefix or activation phrasing
 * are NOT treated as activations (gates per OMX 0.13.2 / 0.14.2).
 */
export function detectKeyword(prompt: string): DetectionResult {
  const normalized = normalizeWorkflowKeyboardTypos(prompt);

  const explicit = findExplicitInvocation(normalized);
  if (explicit) {
    return {
      intent: explicit.intent,
      rawKeyword: explicit.rawKeyword,
      confidence: "high",
      reasoning: `explicit invocation: ${explicit.rawKeyword}`,
    };
  }

  const activation = findActivationPhrase(normalized);
  if (activation) {
    return {
      intent: activation.intent,
      rawKeyword: activation.rawKeyword,
      confidence: "medium",
      reasoning: `activation phrase: "${activation.rawKeyword}"`,
    };
  }

  return {
    intent: null,
    rawKeyword: null,
    confidence: "low",
  };
}
