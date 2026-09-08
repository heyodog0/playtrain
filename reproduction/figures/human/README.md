# Human baseline figure

`plot_wallclock5.py` draws the human-vs-agent wall-clock figure. It reads the
anonymized sessions, which are gzipped, so decompress them first:

```bash
mkdir -p /tmp/study && cd reproduction/figures/human
python -c "import gzip,glob,os,shutil; [shutil.copyfileobj(gzip.open(f,'rb'), open('/tmp/study/'+os.path.basename(f)[:-3],'wb')) for f in glob.glob('../../data/study/*.json.gz')]"
uv run --no-project --with matplotlib --with numpy \
   python plot_wallclock5.py rerun_curves.json /tmp/study out
```

The session filter uses `startedAt` to drop the pilot runs before
`2026-08-05T16:52:00Z`, which is why the anonymized files keep that field
truncated to the minute rather than dropping it.
