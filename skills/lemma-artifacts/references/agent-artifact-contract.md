The document you produce will be appended to the system prompt of a separate LLM-based trace auditor. The auditor sees one condensed agent trace at a time and applies a fixed taxonomy of bad agent behaviors. The auditor has zero prior context about this specific agent. Your document is the agent-specific override that lets the auditor:

a. Identify "the task" on any single trace (so it can grade things like "claimed task completion without performing requested work").
b. Recognize which observed span patterns are normal-for-this-agent vs. genuinely anomalous, including how each tool call is supposed to look.
c. Suppress false positives that the generic taxonomy would otherwise flag (e.g., a mandatory three-pass synthesis that looks like an unprompted loop).

This document is descriptive, not diagnostic. Its job is to teach the auditor how this agent is _supposed_ to work — the task, the normal trace shape, and especially how each tool the agent uses behaves — so the auditor can ground its judgments. Do not catalog the agent's bugs, defects, or "things the auditor should be more alert for"; that is not this document's purpose.

The auditor's calibration taxonomy (these are the categories of bad behavior it is looking for; your rubric should explicitly map agent quirks to whichever of these would otherwise misfire):

- Failure to adapt: "retried same failing approach without changing approach", "retried same failing API call without changing parameters", "didn't retry after partial failure".
- Doing things it shouldn't: "performed action user explicitly told it not to do", "claimed task completion without performing requested work", "offered to perform action it doesn't have the capability to do".
- Doing things poorly: "rewrote entire document instead of making targeted edit", "used slow indirect method when direct tool was available", "fabricated plausible output for content never accessed".
- Quality and correctness issues: "carried forward low-confidence result without verification", "ignored instructions stored in its own context", "stopped before finishing task without acknowledging the gap".
- Inefficiency and waste: "performed sequential steps that could have been parallelized", "loaded full resource when only a small slice was needed", "re-derived information that was already available in context", "excessive context growth from repeated large file reads".
- Session and state issues: "acted on stale context from much earlier in a long session", "looped on the same action unprompted without new user input".
- File operation issues: "attempted to overwrite existing files without reading them first".
- Completion issues: "delivered degraded output without telling the user what was missing", "technically completed the task but left cleanup or follow-up undone".

Writing principles:

- **Structure the body as a real markdown document.** Open with a single `#` title naming the agent. Use `##` for each top-level section. The three core sections are "Agent purpose and the task", "Shape of a normal trace", and "Tool catalog"; add other `##` sections only when the evidence calls for them, and name them whatever fits (e.g., "Intentional quirks", "Sub-agent behavior", or anything else that genuinely earns its place). Use `###` for subheadings where a section has natural sub-parts (e.g., per-phase breakdowns inside "Shape of a normal trace", or one `###` per tool inside "Tool catalog"). Within sections, use whatever form fits the content — prose paragraphs, bullet lists, or short tables — and prefer well-formed markdown over wall-of-text. Skip a section by omitting its heading entirely; do not leave empty headings as placeholders.
- Brevity wins for everything _except_ tool descriptions. Every sentence outside the tool catalog should plausibly change an auditor's decision on a borderline signal — three sharp false-positive carve-outs beat fifteen filler bullets. In the tool catalog, exhaustiveness in **breadth** (one entry per tool the evidence shows in use) is mandatory; depth per entry should match how much the evidence actually establishes about that tool.
- Avoid rigid templates. Don't force every span, pattern, or tool into the same bullet shape — pick whatever form (a paragraph, a tight table, a few bullets, a single sentence) best surfaces the signal for that specific case. A trivial passthrough tool may warrant one sentence; a complex orchestrating tool may warrant several bullets or a small table.
- Concept-level only: never include concrete trace IDs, span IDs, user names, or run-specific anecdotes. Patterns must remain useful after trace retention purges.
- Fold sub-agent behavior into the parent agent description.
- Target length is ~1500–3000 words for the knowledge body, with the tool catalog typically the largest section.
- Never write ASCII diagrams (box-drawing, text flowcharts, or monospace layout diagrams) inside the knowledge body.
- You may include Mermaid diagrams inside the knowledge body when helpful.
- You must produce one overarching Mermaid architecture/flow diagram for the agent as a separate diagram. It must be valid mermaid that compiles cleanly.
- **Inline confidence and recency where it matters.** When you state a pattern, claim, or carve-out, append a short qualifier in the same line/bullet when it isn't high-confidence — e.g., `(high confidence — seen across multiple traces)`, `(low confidence — single trace)`, `(based on traces from <approximate window>)`. When a claim rests on source code rather than observed runs, say so in the same shape — e.g., `(intended — from source, not observed)` — because the auditor otherwise reads every claim as describing what actually happens. Do **not** create a standalone "Confidence and currency" section; weave these qualifiers into the relevant sentences instead.

What the document must cover:

- **Agent purpose and "the task"**: a few sentences telling the auditor what this agent is asked to do per run and how to recognize, on a single trace, what counts as the task and what counts as successful completion. This is what lets the auditor grade things like "claimed task completion without performing requested work."

- **Shape of a normal trace**: the mandatory span sequence, what's optional, what missing spans imply. Call out — explicitly and by name — any required subsequences that _look like_ the auditor's bad-behavior phrases but are by design (e.g., a review-then-synthesize-then-answer triplet that resembles "looped on the same action unprompted," or post-hoc safety re-checks that resemble "performed sequential steps that could have been parallelized"). These callouts are what stop the highest-volume false positives. Omit this section entirely when you have no evidence of how the agent behaves at runtime; do not infer a trace shape from control flow you have only read.

- **★ Tool catalog** (highest leverage — the auditor's main reference): one `###` subheading per tool the agent calls in production (use the exact tool name as it appears in spans). For each tool, give the auditor enough to recognize and judge a call to that tool in isolation. Choose whatever form best fits each tool — a short paragraph, a few bullets, a tight table, or a single sentence — and skip dimensions that genuinely don't apply.

  Across the catalog (not necessarily within every entry) make sure the following are surfaced wherever the evidence establishes them, because the auditor relies on them to interpret tool spans:
  - what the tool does and roughly when it fires (mandatory every run, conditional on something specific, or opportunistic);
  - what kind of arguments the agent passes (user-derived strings, IDs from earlier tool results, fixed enums, always-present defaults), with concrete examples where useful;
  - the shape and rough size of the tool result the auditor will see (top-level JSON keys, wrapping conventions like `<phi>...</phi>`, paginated envelopes, base64 blobs, what empty/error results look like);
  - sequencing and fan-out — which tools fire alongside it in parallel vs. strictly sequentially, what comes immediately before/after, and typical call counts per run;
  - latency band the auditor should treat as normal (e.g., `<1s`, `~10–40s`, `p95 ~2s`), so it doesn't flag normal slowness;
  - any tool-specific idiom (output wrapping, retry pattern, partial-result behavior, etc.) that would otherwise look like a generic-taxonomy violation.

  These are dimensions to consider, not required headings. A trivial passthrough tool may need one sentence covering only purpose and latency; a complex orchestrating tool may warrant several bullets across most of these dimensions. Match depth to evidence — if the evidence only establishes a tool's purpose and call count, say that and stop, rather than padding with speculation. Be exhaustive in **breadth**: include every tool the evidence shows in use, even when an entry is one sentence. Do not invent tools the evidence does not support; if only 3 of the agent's 7 tools are confirmed, document those 3 and note the gap. The tool catalog is intentionally not subject to the "brevity wins" rule applied elsewhere — but exhaustiveness means breadth across tools, not template-filling within them.

Beyond those, decide for yourself what else is worth surfacing for this specific agent based on the evidence. The criterion is always: _will this materially change the auditor's decision on a borderline trace?_ If yes, include it; if no, leave it out. There's no required additional section list.

A common — but not mandatory — thing worth surfacing is **cross-cutting design choices that resemble the auditor's bad-behavior taxonomy but are by design** (e.g., a deliberate model switch mid-run, a mandatory multi-pass loop, an always-large prompt context, a conditional sub-graph that resembles unprompted looping). When such quirks exist and the false-positive risk is real, surface them — anywhere in the document that fits, or as their own section if there are several — making clear both _what_ the quirk is and _which calibration phrase_ it would otherwise misfire under. If the agent doesn't have meaningful cross-cutting quirks beyond what's already covered in the trace-shape callouts and per-tool entries, don't manufacture a section for it.

Architecture prose, model trivia, latency tables for individual middlewares, lists of agent bugs or failure modes, standalone confidence sections, and any "for completeness" content that doesn't change auditor decisions should be omitted.
