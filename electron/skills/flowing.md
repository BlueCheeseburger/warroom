# Flowing — How to Flow a Document into a Flow Sheet

Transfer the content of a debate document (case, block, article) into a Warroom flow sheet using edit_flow_cell. Execute immediately — never ask the user for column or row mapping instructions.

---

## What is a flow?

A flow is a structured grid that tracks debate arguments across speeches. Each **column** is a speech (e.g. 1AC, 2NC, 1AR). Each **row** is a distinct argument or sub-point. Each **sheet/tab** is a separate section of the round (e.g. "On Case", "Off 1", "Off 2", "T").

---

## Step-by-step workflow

1. **Get the document content**
   - If it was attached as a @mention or speech doc, the text is already in context.
   - If the user named a .docx file, call `read_speech_doc(name)` to extract it.

2. **Get the flow structure**
   - If the flow was @mentioned, its sheets and columns are already in context.
   - Otherwise call `list_flows` then `read_flow(name)` to get sheet names and column headers.

3. **Map content to columns**
   Match document type to column using debate convention:
   - Affirmative case / 1AC → column named "1AC" (or "Aff" / "Pro Case" in PF)
   - 2AC extensions → column "2AC"
   - Negative block / 1NC → column "1NC" (or "Neg" / "Con Case" in PF)
   - 2NC / block → "2NC"
   - 1NR → "1NR"
   - 1AR → "1AR"
   - 2NR → "2NR"
   - 2AR → "2AR"
   - If no column matches exactly, pick the closest one.

4. **Map content to sheets**
   Match document sections to sheet tabs:
   - Topicality / T args → sheet named "T" or "Topicality"
   - Off-case positions (DAs, CPs, Ks) → sheets named "Off 1", "Off 2", etc., or "DA", "CP", "K"
   - On-case attacks (Inherency, Harms, Solvency, Adv attacks) → "On Case" sheet or "Inherency" / "Harms" / "Solvency" tabs
   - If the flow only has one sheet, put everything there.

5. **Write cells**
   - One `edit_flow_cell` call per cell.
   - Each distinct argument, contention, sub-point, or card gets its own row.
   - **Cell text is shorthand** — 2–6 words that capture the argument. Not full sentences. Not card text.
   - Start at row 1 for new content unless rows are already occupied (check the flow data).
   - Run all cells in parallel (one big batch of edit_flow_cell calls).

6. **Report back**
   After all edits complete, tell the user what you did: how many cells were filled, which sheet(s) and column(s) were used.

---

## Shorthand conventions

Flow shorthand compresses arguments to their essence. Examples:

| Full argument | Flow shorthand |
|---|---|
| "The United States federal government lacks a comprehensive cybersecurity policy" | "SQ lacks cyber policy" |
| "Advantage 1: Preventing nuclear war through diplomacy" | "Adv 1 — nuke war" |
| "Counterplan: The 50 states and territories should..." | "CP — 50 states" |
| "Topicality — 'engagement' means economic" | "T — engagement = econ" |
| "Non-unique — spending is high now" | "NU — spending high" |
| "Turn — plan increases hegemony" | "Turn — plan → heg up" |
| "Solvency — plan mandates solve" | "Solv — mandate solves" |
| "Inherency — status quo can't solve" | "Inh — SQ fails" |
| "Link — plan links to politics DA" | "Link — pol DA" |
| "Impact — great power war" | "Imp — GPW" |

Keep it brief. A debater should be able to read it at a glance.

---

## Mapping a policy 1AC

A standard policy affirmative follows this structure. Map each section to a row in the 1AC column:

| Section | Row content |
|---|---|
| Plan text | "Plan — [agency] shall [action]" |
| Inherency | "Inh — [status quo problem]" |
| Advantage 1 title | "Adv 1: [name]" |
| Advantage 1 — Significance/Harms | "Harms — [impact]" |
| Advantage 1 — Solvency | "Solv — [mechanism]" |
| Advantage 2 title | "Adv 2: [name]" |
| ... (repeat per advantage) | |
| Framework (if LD/PF) | "FW — [value/criterion]" |

---

## Mapping a negative block

For a negative block or 1NC off-case position:

| Section | Row content |
|---|---|
| Position name | e.g. "Politics DA" |
| Uniqueness | "NU — [current state]" |
| Link | "Link — plan → [link]" |
| Internal link | "IL — [mechanism]" |
| Impact | "Imp — [harm]" |
| Extensions / additional args | one row each |

---

## Mapping a 2AC

The 2AC answers off-case and extends on-case. If the flow has separate sheets per off-case position:

- Write answers in the "2AC" column on the sheet matching the off-case (e.g. "Off 1")
- Write on-case extensions in the "2AC" column on the "On Case" or inherency/solvency sheet

---

## Multi-sheet documents

If a document covers multiple positions (e.g. a full 1NC block file with T + DA + CP + on-case):
- Split by position, one sheet per position
- Use the appropriate sheet and column for each

---

## What NOT to do

- **Never ask the user which column or row** — infer from document structure and debate convention, then execute.
- **Never paste full card text into a cell** — flow shorthand only.
- **Never use write_skill** for flow content — always use edit_flow_cell.
- **Never skip a section** because you're unsure where it goes — make a reasonable choice, note it in your summary.
