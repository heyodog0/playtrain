# Third-party components

PlayTrain's wheels bundle a compiled native backend that statically links the
components below. Their notices are reproduced here because they travel with the
binary. The build fetches the sources rather than vendoring them
(`native/build_qjs.sh`).

| component | role | license |
|---|---|---|
| [quickjs-ng](https://github.com/quickjs-ng/quickjs) | the JavaScript engine games run on | MIT |
| [openlibm](https://github.com/JuliaMath/openlibm) (fdlibm) | bit-reproducible `Math.*`, so a game steps identically everywhere | MIT / Sun fdlibm |
| [matter-js](https://brm.io/matter-js/) 0.20.0 | 2D physics for the games that use it (`tools/vendor/matter.min.js`, MIT header inline) | MIT |
| [ProcGen](https://github.com/openai/procgen) | reference C++ sources, not compiled — see `games/procgen_src/LICENSE` | MIT |

---

## quickjs-ng

Copyright (c) 2017-2026 Fabrice Bellard
Copyright (c) 2017-2024 Charlie Gordon
Copyright (c) 2023-2026 Ben Noordhuis
Copyright (c) 2023-2026 Saúl Ibarra Corretgé

## openlibm

Portions used here are fdlibm, carrying the original Sun notice:

    Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.

    Developed at SunPro, a Sun Microsystems, Inc. business.
    Permission to use, copy, modify, and distribute this
    software is freely granted, provided that this notice
    is preserved.

openlibm as a whole is distributed under its own terms; see
https://github.com/JuliaMath/openlibm/blob/master/LICENSE.md.

## MIT License

Applies to quickjs-ng, matter-js, ProcGen and the MIT-licensed portions of
openlibm, each under the copyright lines given above.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
