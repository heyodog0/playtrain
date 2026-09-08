---
name: Bug report
about: Something behaves incorrectly
labels: bug
---

**What happened, and what you expected instead**

**To reproduce** — the smallest snippet that shows it. Please include the game name and
the seed if it is environment-specific.

```python
```

**Environment**
- PlayTrain version (`python -c "import playtrain; print(playtrain.__version__)"`):
- Installed from wheel or built from source:
- OS and CPU:
- Python version:

**Throughput issues only:** which access path you measured (`GameEnv`, `NativeVecEnv`,
or the C loop) — see `benchmarks/README.md`. The three cost very different amounts per
step and are not comparable.
