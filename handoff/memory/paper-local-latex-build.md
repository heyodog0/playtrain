---
name: paper-local-latex-build
description: How to compile the ICLR paper locally with tectonic, and the two packages that make it abort
metadata:
  type: project
---

The paper **can** be compiled locally. `tectonic` is installed (Homebrew), and
there is no pdflatex/latexmk. Build a stubbed copy rather than the file itself:

    # in a scratch dir with figures/ *.sty *.bst *.bib math_commands.tex copied in
    s.replace(r"\usepackage{marvosym}",     r"\providecommand{\Mundus}{[www]}%")
    s.replace(r"\usepackage{fontawesome5}", r"\providecommand{\faGithub}{[gh]}\providecommand{\faEnvelope}{[@]}%")
    tectonic -X compile paper.tex --outdir $B --keep-logs

**`fontawesome5` aborts tectonic with SIGABRT (exit 134), no log, no message.**
`marvosym` is stubbed with it for safety. Neither affects layout, so a stubbed
build is valid for checking floats, overfull boxes, and captions. An exit 134
with a silent log almost always means a font package, not a TeX error; bisect the
preamble by compiling prefixes rather than reading the log.

Inspect results with `pdftoppm -f N -l N -r 110 -png paper.pdf out` and read the
PNG; `pdftotext -f N -l N` finds which page a float landed on.

**`float` and `floatrow` cannot coexist.** floatrow errors "Do not use float
package with floatrow. The latter will be skipped" and then silently disables
every floatrow row, so side-by-side floats render stacked, the table gets a
Figure number, and a stray `[]` appears. Fix is to drop `\usepackage{float}`;
floatrow provides `[H]` itself and the six appendix `[H]` figures still place.

In a floatrow, give each box an **explicit width** (`\ffigbox[0.52\textwidth]`,
`\capbtabbox[0.44\textwidth]`). With `\FBwidth` the box shrinks to its content,
so a narrow tabular squeezes its caption into a ragged over-hyphenated column,
and `\ffigbox[\FBwidth]` is circular and hangs the engine.
