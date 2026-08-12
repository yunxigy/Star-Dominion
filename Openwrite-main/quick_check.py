import os
novels_dir = os.path.join(os.path.dirname(__file__), 'data', 'novels')
novel_ids = ['farm_ancient', 'rebirth_sweet', 'system_urban']
out = []
for nid in novel_ids:
    mdir = os.path.join(novels_dir, nid, 'data', 'manuscript', 'arc_001')
    if not os.path.exists(mdir):
        continue
    out.append(f"\n{nid}:")
    files = sorted([f for f in os.listdir(mdir) if f.endswith('.md')])
    for f in files:
        path = os.path.join(mdir, f)
        with open(path, 'r', encoding='utf-8') as fh:
            lines = fh.readlines()
        out.append(f"  {f}: {len(lines)} lines")

# Write to file
with open(os.path.join(os.path.dirname(__file__), 'quick_check_result.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))