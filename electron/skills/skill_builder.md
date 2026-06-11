# Skill Builder Guide

Skills are Markdown knowledge files that Warroom AI loads on demand via `get_skill(name)`. They let users save any knowledge — debate strategy, coach notes, argument files, topic research, judging tendencies — so Warroom AI can reference it in future conversations without the user having to re-explain it.

## What makes a good skill

A skill should be **self-contained and scannable**. When Warroom AI loads it, the full content is injected into the conversation. Good skills are:
- Focused on one topic or purpose (better to have two focused skills than one sprawling one)
- Written in clear headings and bullet points, not dense paragraphs
- Specific enough to actually change how the AI responds (avoid generic advice)
- 200–2000 words — long enough to be useful, short enough to stay in focus

## Skill file format

```markdown
# [Skill Title]

## [Section heading]
Content here...

## [Another section]
More content...
```

Use `##` headings to organize sections. Bullet points work better than prose for strategy notes and lists.

## Naming conventions

Skill names are lowercase with underscores, no spaces or special characters:
- `my_coach_tips` ✅
- `aff_case_strategy` ✅
- `judge_john_smith` ✅
- `My Coach Tips` ❌ (spaces not allowed)

The name is what the user (or Warroom AI) types to load it: `get_skill("my_coach_tips")`.

## How to help a user build a skill

1. **Ask what they want to save** if unclear. Good prompts: "What should Warroom AI know from this?" or "Is this notes, strategy, or reference material?"
2. **Draft the skill content** based on what they share — don't ask them to write it themselves.
3. **Pick a descriptive name** — short, lowercase, underscores. Confirm with the user before saving.
4. **Call `write_skill`** with the name, content, and a one-sentence description.
5. **Tell the user how to use it**: "You can now say `load my [name] skill` or I'll load it automatically when relevant."

## Skill categories (examples)

**Coach / team notes**
Save your coach's paradigm, preferred arguments, flow conventions, or team strategy.
Example: `coach_paradigm`, `team_strategy_2026`

**Judge research**
Collected notes on a specific judge — how they flow, what they vote on, quirks.
Example: `judge_kim_notes`

**Argument files**
A full argument brief: blocks, extensions, key evidence tags.
Example: `spending_da_blocks`, `cap_k_answers`

**Topic research**
Background knowledge on the current resolution that the AI should have handy.
Example: `health_insurance_background`

**Personal preferences**
How you like the AI to format responses, your debate style, your event specifics.
Example: `my_preferences`

## Updating a skill

Call `write_skill` with the same name — it overwrites the existing file. Always read the current content first (`get_skill`) if doing a partial update so you don't lose existing sections.

## Deleting a skill

Tell the user they can delete skill files directly from: **Settings → Skills** (or the skills folder in their app data). Warroom AI cannot delete skills.
