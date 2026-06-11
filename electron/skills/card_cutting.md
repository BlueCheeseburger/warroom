# Card Cutting — Verbatim Format

Cut policy debate evidence cards from raw source material. Match the exact formatting conventions of the Verbatim Word plugin.

---

## Card Anatomy

Every card has three parts in this exact order:

1. **Tag** — debater's 1–2 sentence summary of the argument. Written as a declarative claim (what the card *proves*). Uses `####` heading markdown. Bold.
2. **Cite** — author info + publication details. Plain text, NOT bolded.
3. **Body** — the excerpt from the source. Key sentences underlined.

---

## Cite Format — Follow Exactly

Pattern: `Lastname YY, [credentials]. [Full First Names], [Full Date]. "[Title]." [URL]`

### Short cite rules
- 1 author: `Brady 25`
- 2 authors: `Lee and Poling 23`
- 3+ authors: `Smith et al. 24`
- **Current year (2026): use month-day instead of year** → `Brady 3-15` (for March 15, 2026)
- **Past years: two-digit** → `Brady 25`

### After the short cite
Full author credentials/title → Full first names → Full date (Month Day, Year) → Article title in quotes → URL in brackets. No period after the URL bracket.

If credentials aren't in the source text, note "quals unknown" in the cite. If the exact publish date is unknown for current-year cards, ask the user.

### Example
```
Borsari and Davis 25, Fellows at the Transatlantic Defense and Security Program and the Center for European Policy Analysis. Federico Borsari, Gordon B. Davis, Jr, December 16, 2025. "High Stakes in the High North: Harnessing Uncrewed Capabilities for Arctic Defense and Security." [https://cepa.org/commentary/high-stakes-in-the-high-north/]
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

## Full Example Card

```
#### Surveillance systems provide deterrence by detection in the Arctic

Borsari and Davis 25, Fellows at the Transatlantic Defense and Security Program and the Center for European Policy Analysis. Federico Borsari, Gordon B. Davis, Jr, December 16, 2025. "High Stakes in the High North: Harnessing Uncrewed Capabilities for Arctic Defense and Security." [https://cepa.org/commentary/high-stakes-in-the-high-north/]

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
- When in doubt on current-year date: ask the user for the exact publish date
- Always trim the body to just what proves the tag — don't paste the whole article
- For `save_card_to_library`: tag = plain text (no ####), body = clean verbatim (no underscores/bold), year = 4-digit integer
