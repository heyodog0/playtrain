# Security

## Reporting

Report vulnerabilities through GitHub's [private advisory
form](https://github.com/heyodog0/playtrain/security/advisories/new), not a public issue.
Expect an acknowledgement within a few days. This is a research project maintained by a
small group. Please allow reasonable time for a fix before disclosing.

## Scope worth knowing about

**PlayTrain executes JavaScript.** A game file is a program, run in an embedded QuickJS
interpreter with no browser sandbox and no network or filesystem bindings exposed to it.
Treat a game file from an untrusted source the way you would any untrusted code. The
isolation is QuickJS's own, and it is not a security boundary we have hardened.

**The development servers are for localhost.** `tools/tester.py` exposes unauthenticated
endpoints that generate and refine games through the Gemini API, billed to whatever key
is in the environment, and write to the game catalog. It binds to loopback by default.
`--host` widens it. Do not widen it.

**API keys** are read only from the environment (`GEMINI_API_KEY`), only by
`playtrain.gen`. The runtime and the trainers never read one. See `.env.example`.
