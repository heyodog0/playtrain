import json

d = json.load(open('outputs/percmd.json'))
g = json.load(open('outputs/grid.json'))
pr, su = d['price_ns'], d['shape_unit_ns']


def bill(r):
    b = sum(v * pr.get(k, pr['rect']) / 1000 for k, v in r['per_cmd'].items())
    ns = r['per_cmd'].get('endShape', 0)
    if ns:
        b += ns * su * max(r['per_cmd'].get('vertex', 0) / ns, 1) / 3 / 1000
    return b


rows = sorted(d['rows'], key=lambda r: -r['sps'])
L = [r'\begin{tabular}{@{}lrrr@{}}', r'\toprule',
     r'game & p5 commands/frame & drawing & env steps/s \\', r'\midrule']
for r in rows:
    n = sum(r['per_cmd'].values())
    pct = 100 * bill(r) / r['us_per_step']
    name = r['game'].replace('_', r'\_')
    L.append(f"{name} & {n:,.0f} & {pct:.0f}\\% & {r['sps']:,.0f} " + r'\\')
L += [r'\bottomrule', r'\end{tabular}']
open('outputs/figs/tab_envcost.tex', 'w').write('\n'.join(L) + '\n')
print('\n'.join(L[:6]))
print('...', len(rows), 'rows')
