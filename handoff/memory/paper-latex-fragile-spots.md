---
name: paper-latex-fragile-spots
description: Two hand-tuned constructs in the ICLR paper that break silently when text around them moves
metadata:
  type: project
---

**Table 1 is a `wraptable` and can silently drop rows.** `wrapfig` cannot split a
box across a page break. When Table 1 straddled the page 6/7 boundary, its bottom
four rows (the environment-swap block, 618k/372k/873k/175k) vanished from the PDF
entirely, with a clean compile and no warning. Verified with
`pdftotext paper.pdf - | grep 618k` returning 0.

- The tell is a narrow orphaned column of text at the top of the following page.
- It currently sits at the head of the `\textbf{Environment efficiency.}`
  paragraph, which starts high enough on the page that all 22 lines fit.
- It must precede the run-in heading line. Placing it after splits `\textbf{...}`
  from its paragraph and LaTeX stretches the two words across the full measure.
- `[22]` (line span) and `\vspace{-13.3pt}` (caption baseline alignment) are both
  tuned to the current page composition and need re-measuring if text above moves.
- A plain `\begin{table}[t]` float cannot fail this way. That is the fallback.

**The JSON listing colours keys and values from explicit `emph` lists.**
`lstlisting` has no parser, so the `jsonfig` style names every key in one `emph`
class (purple) and every string value in a second (green). Adding a line to that
listing without adding its token to the right list renders it black.
`language={}` on the style is load-bearing: `default` and `type` are JavaScript
keywords and would otherwise be highlighted inside `"default8"` and `"type"`.
Do not add `morestring=[b]"` to the JavaScript language definition; once the
quoted text is a string, `emph` cannot reach inside it.

See [[paper-local-latex-build]] for how to compile and inspect locally.
