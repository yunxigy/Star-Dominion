"""Scan all novel chapters for garbled text, encoding issues, and anomalies - deep scan."""
import os, re, sys
from collections import Counter, defaultdict

novels_dir = os.path.join(os.path.dirname(__file__), 'data', 'novels')
novel_ids = ['farm_ancient', 'rebirth_sweet', 'system_urban']
issues = []

for nid in novel_ids:
    mdir = os.path.join(novels_dir, nid, 'data', 'manuscript', 'arc_001')
    if not os.path.exists(mdir):
        continue
    files = sorted([f for f in os.listdir(mdir) if f.endswith('.md')])
    print(f'\n=== Deep scan: {nid} ({len(files)} chapters) ===')

    chapter_stats = []
    for fn in files:
        fp = os.path.join(mdir, fn)
        with open(fp, 'rb') as f:
            raw = f.read()
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError as e:
            issues.append((nid, fn, f'UTF8_ERROR: {str(e)[:60]}'))
            continue

        cn_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        punct_chars = len(re.findall(r'[，。！？、；：""''（）…—《》]', text))
        eng_chars = len(re.findall(r'[a-zA-Z]', text))
        num_chars = len(re.findall(r'[0-9]', text))
        total_chars = len(text.strip())

        # Punctuation to Chinese ratio (high = possibly garbled or low content)
        if cn_chars > 0:
            punct_ratio = punct_chars / cn_chars
        else:
            punct_ratio = 999

        # Check for repeated single characters (sign of corruption)
        char_counts = Counter(re.findall(r'[\u4e00-\u9fff]', text))
        repeated_chars = [(ch, cnt) for ch, cnt in char_counts.most_common(5) if cnt > cn_chars * 0.05]

        # Check for lines that are mostly non-Chinese
        lines = text.split('\n')
        weird_lines = []
        for i, line in enumerate(lines):
            line_cn = len(re.findall(r'[\u4e00-\u9fff]', line))
            line_total = len(line.strip())
            if line_total > 20 and line_cn / line_total < 0.3:
                weird_lines.append((i+1, line.strip()[:80]))

        # Check for consecutive repeated sentences
        sentences = re.findall(r'[^。！？]+[。！？]', text)
        consecutive_repeats = 0
        for i in range(1, len(sentences)):
            if sentences[i].strip() == sentences[i-1].strip() and len(sentences[i].strip()) > 10:
                consecutive_repeats += 1

        # Check for very high English content (might be error message)
        if cn_chars > 0:
            eng_ratio = eng_chars / cn_chars
        else:
            eng_ratio = 999

        chapter_stats.append({
            'fn': fn, 'cn_chars': cn_chars, 'punct_ratio': punct_ratio,
            'eng_ratio': eng_ratio, 'weird_lines': weird_lines,
            'consecutive_repeats': consecutive_repeats,
            'repeated_chars': repeated_chars, 'text': text
        })

        # Flag issues
        if cn_chars < 500:
            issues.append((nid, fn, f'VERY_SHORT: only {cn_chars} Chinese chars'))

        if punct_ratio > 1.5 and cn_chars > 100:
            issues.append((nid, fn, f'HIGH_PUNCT_RATIO: {punct_ratio:.2f} (punct/cn)'))

        if eng_ratio > 0.5 and cn_chars > 100:
            issues.append((nid, fn, f'HIGH_ENG_RATIO: {eng_ratio:.2f} (eng/cn)'))

        if len(weird_lines) > 3:
            issues.append((nid, fn, f'WEIRD_LINES: {len(weird_lines)} lines with <30% Chinese'))
            for ln, content in weird_lines[:3]:
                issues.append((nid, fn, f'  LINE_{ln}: {content}'))

        if consecutive_repeats > 3:
            issues.append((nid, fn, f'CONSECUTIVE_REPEATS: {consecutive_repeats} repeated sentences'))

        if repeated_chars:
            for ch, cnt in repeated_chars:
                issues.append((nid, fn, f'REPEATED_CHAR: "{ch}" appears {cnt} times ({cnt/cn_chars*100:.1f}% of cn chars)'))

    # Check for duplicate chapters (same content)
    content_hashes = defaultdict(list)
    for cs in chapter_stats:
        # Use first 500 chars as hash
        h = re.sub(r'\s+', '', cs['text'][:500])
        content_hashes[h].append(cs['fn'])
    for h, fns in content_hashes.items():
        if len(fns) > 1:
            issues.append((nid, fns[0], f'DUPLICATE_CHAPTER: same as {", ".join(fns[1:])}'))

print(f'\n\n========== RESULTS ==========')
print(f'Found {len(issues)} issues\n')
for nid, fn, issue in issues:
    print(f'{nid}/{fn}: {issue}')
if not issues:
    print('No issues found.')