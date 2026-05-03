# skills/

Project-local skills that capture **Telegraph's development conventions**.

These are written in Claude Code's [skill format](https://docs.claude.com/en/docs/claude-code/skills) (a `SKILL.md` file with frontmatter inside each skill folder), so any agent working on this repo can load them and follow the same rules.

## Layout

```
skills/
├── README.md                          # this file
└── telegraph-conventions/
    └── SKILL.md                       # umbrella skill — all repo conventions live here
```

Start with one umbrella skill (`telegraph-conventions`) and grow it section-by-section. Split a section into its own skill folder only when:

- It becomes long enough that the umbrella file is hard to scan, or
- It needs its own bundled assets (templates, scripts, references) that don't belong in the main `SKILL.md`.

## When to add a new convention

Add a new section to `telegraph-conventions/SKILL.md` whenever:

1. You catch yourself (or another agent) making the same mistake twice.
2. The user corrects an approach with a rule that will apply to future work ("we always do X here", "don't do Y, use Z instead").
3. You discover a non-obvious project rule by reading code or commit history that future-you would benefit from being told upfront.

Each convention should follow the **Rule / Why / How to apply** structure (see existing entries in `telegraph-conventions/SKILL.md`) so the next reader can judge edge cases instead of blindly following a rule.

## When NOT to add a convention

- It's already in `AGENTS.md` (the human-facing repo README for agents). Reference it from there instead of duplicating.
- It's a one-off task detail, not a recurring rule.
- It's about external tools (TypeScript / React / Tailwind) with no Telegraph-specific twist — link to upstream docs.
