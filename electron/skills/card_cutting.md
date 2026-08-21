# Card Cutting — Verbatim Format

Cut policy debate evidence cards from raw source material. Match the exact formatting conventions below — sourced from the UC Berkeley 2026 Verbatim formatting guide.

---

## Card Anatomy

Every card has three parts in this exact order:

1. **Tag** — debater's 1–2 sentence summary of the argument. Written as a declarative claim (what the card *proves*). Uses `####` heading markdown. Bold.
2. **Cite** — author info + publication details. Plain text, NOT bolded.
3. **Body** — the excerpt from the source. Key sentences underlined.

---

## Cite Format — Follow Exactly

Pattern: `Lastname YY — First Last. Month Day, Year. Qualifications. Publication, "Title," URL`

- Separator between the short cite and the rest: ` — ` (em dash with spaces on both sides)
- After the em dash: full first+last name(s) → full date → author qualifications (as their own sentence) → publication name → article title in quotes → URL
- No brackets around the URL. No period after the URL.
- Cite is plain text — never bolded.

### Short cite rules
- 1 author: `Brady 25`
- 2 authors: `Modi and Smith 26`
- 3+ authors: `Schmitz et al. 23`
- **Time-sensitive (evidence from roughly the past two months): use month-day instead of year** → `Brady 3-15` (for March 15). Put the full year in the body of the cite instead. Only use this for evidence genuinely that recent — not just "this calendar year."
- **Everything else (including the rest of the current year): two-digit year** → `Brady 25`
- This is the default. The Card Cutter's AI step can be switched to always use the two-digit year (even for very recent sources) via Settings → General → "Current-year short cite" — when that's set, use `Brady 26` style year-round instead.

If credentials aren't in the source text, note "quals unknown" in the cite. If the exact publish date is unknown for a time-sensitive card, ask the user.

### Examples

Standard:
```
Hirsh 25 — Michael Hirsh. April 11, 2025. Former foreign editor and chief diplomatic correspondent for Newsweek, and the former national editor for Politico Magazine. Politico, "Trump May Be Triggering the Fastest Nuclear Weapons Race Since the Cold War," https://www.politico.com/news/magazine/2025/04/11/trump-says-he-fears-nuclear-weapons-so-why-is-he-making-them-more-popular-00278790
```

Time-sensitive:
```
Rubin 1-7 — Richard Rubin. 2025. US tax policy reporter for The Wall Street Journal. WSJ, "Debt-Ceiling Fight Has New X Factor: Trump," https://www.wsj.com/...
```

Two authors — first last name only in the short cite; both full names in the body, joined by "and"; each author gets their own qualification sentence:
```
Modi and Smith 26 — Shreeram Modi and John Smith. May 15, 2026. Undergraduate student at NYU. Professor of Political Science at Stanford. Daily Cal, "Title," URL
```

Three or more authors — "et al." after the first last name in the short cite; all full names listed in the body, last one joined with "and"; each author still gets their own qual sentence:
```
Schmitz 23 — Oswald J. Schmitz, Magnus Sylvén, and Trisha B. Atwood. 2023. Professor of Population and Community Ecology in the Yale School of the Environment, PhD from the University of Michigan. PhD in Animal Ecology from Lund University, Director of the Global Rewilding Alliance. Associate Professor of Ecology at Utah State University, PhD in Ecology from the University of British Columbia. Nature Climate Change, "Trophic Rewilding Can Expand Natural Climate Solutions," vol. 13
```

Journal articles — same structure, but use a DOI as the URL when available (most authoritative); if no DOI, use volume (`vol. 13`), page numbers (`p. 65-67`), or issue number (`no. 3`) in place of the URL:
```
Haynes 25 — Abby Haynes, Catherine Sherrington, et al. 2025. Research Fellow at the Institute for Musculoskeletal Health, University of Sydney, PhD. Professor, Sydney School of Public Health, University of Sydney. The International Journal of Sport and Society, "Title," https://doi.org/10.xxxxx
```

---

## Tag Format

- Use `####` heading markdown (Verbatim Heading 4)
- **Bold**
- 1–2 sentences max
- Written as a strong declarative claim the card PROVES — not a description of what it says
- Think: what would you say on the flow? "Smith 25 — surveillance provides deterrence by detection"

### Good tag: `#### Surveillance systems provide deterrence by detection in the Arctic`
### Bad tag: `#### Smith discusses how surveillance relates to deterrence`

---

## Body Format

- Paste the relevant excerpt **verbatim** — do NOT paraphrase, summarize, or alter the author's words
- **Underline** the most critical sentences/phrases using `_underscores_` (= lines read aloud in round)
- **Bold** the most critical 1–3 words/phrases WITHIN underlined sections using `**bold**` (= double-underlined in Verbatim, used for the single most important words)
- Cut aggressively — only include what's needed to prove the tag. Trim fat.
- When saving to library via save_card_to_library, the body must be clean verbatim text (no markdown underscores or bold markers)

---

## Verbatim Style Notes

All files should use **Verbatim** styles, not direct formatting. Key styles:
- **Analytic** — for written blocks/analytics; stripped from send doc automatically
- **Undertag** — for notes on a card; also stripped from send doc, doesn't appear in nav pane
- Never apply font/size/color directly to text — always modify via Verbatim > Settings > Styles

---

## Full Example Card

```
#### Surveillance systems provide deterrence by detection in the Arctic

Borsari and Davis 25 — Federico Borsari and Gordon B. Davis, Jr. December 16, 2025. Fellows at the Transatlantic Defense and Security Program and the Center for European Policy Analysis. CEPA, "High Stakes in the High North: Harnessing Uncrewed Capabilities for Arctic Defense and Security," https://cepa.org/commentary/high-stakes-in-the-high-north/

Deterrence in the Arctic greatly depends on situational awareness and signaling. _Drones can contribute to this key objective through what scholars have defined as "deterrence by detection," the notion that **persistent monitoring of adversary activity complicates their freedom of maneuver** and raises the costs of covert or coercive actions._ In practice, this means tracking Russian submarine patrols, monitoring aircraft flights across the Barents and Bering Seas, and detecting changes in Arctic force posture. _**Overall, multi-domain situational awareness is by far the top priority for Arctic allies given the ISR gap and increased Russian and Chinese activity in the region.**_
```

---

## Workflow

1. **If given a URL**: call `fetch_article` to get the text, then proceed
2. **If given raw text**: use it directly
3. Find the 1–5 sentences that most directly prove a debate argument. Prefer specific, empirical claims over vague generalizations.
4. Write the tag as a bold declarative claim
5. Write the cite per the exact rules above
6. Format the body with underscores and bold
7. Output: Tag → Cite → Body
8. Offer to save with `save_card_to_library`

---

## Tips
- If the user gives a long article and says "cut cards on X", find ALL relevant passages and cut multiple cards
- If the author's credentials aren't in the excerpt, note "quals unknown" and continue
- When in doubt on a time-sensitive date: ask the user for the exact publish date
- Always trim the body to just what proves the tag — don't paste the whole article
- For `save_card_to_library`: tag = plain text (no ####), body = clean verbatim (no underscores/bold), year = 4-digit integer
