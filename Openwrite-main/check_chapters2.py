"""Deep scan v2: Check for content anomalies, cross-novel contamination, duplicates."""
import os, re, sys
from collections import Counter, defaultdict
import hashlib

novels_dir = os.path.join(os.path.dirname(__file__), 'data', 'novels')
novel_ids = ['farm_ancient', 'rebirth_sweet', 'system_urban']
issues = []

# Character name signatures for each novel
novel_signatures = {
    'farm_ancient': ['林小满', '沈青石', '王大娘', '周文安', '钱进', '青石镇'],
    'rebirth_sweet': ['苏念', '顾行舟', '周宇航', '林薇', '苏晴'],
    'system_urban': ['陈默', '摆烂系统', '张伟', '刘芳', '赵明远', '星耀'],
}

all_chapter_fingerprints = {}  # hash -> (novel_id, filename)

for nid in novel_ids:
    mdir = os.path.join(novels_dir, nid, 'data', 'manuscript', 'arc_001')
    if not os.path.exists(mdir):
        continue
    files = sorted([f for f in os.listdir(mdir) if f.endswith('.md')])
    print(f'\n=== Scanning: {nid} ({len(files)} chapters) ===')

    prev_content = None
    prev_fn = None

    for fn in files:
        fp = os.path.join(mdir, fn)
        with open(fp, 'rb') as f:
            raw = f.read()
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError as e:
            issues.append((nid, fn, f'UTF8_ERROR'))
            continue

        cn_chars = len(re.findall(r'[\u4e00-\u9fff]', text))

        # 1. Check for cross-novel contamination
        for other_nid, other_names in novel_signatures.items():
            if other_nid == nid:
                continue
            found_names = []
            for name in other_names:
                if name in text:
                    found_names.append(name)
            if found_names:
                issues.append((nid, fn, f'CROSS_NOVEL: contains {other_nid} names: {found_names}'))

        # 2. Check for duplicate content across ALL novels
        # Use hash of full content (normalized)
        normalized = re.sub(r'[\s\n\r]+', '', text)
        content_hash = hashlib.md5(normalized.encode()).hexdigest()
        if content_hash in all_chapter_fingerprints:
            other_nid, other_fn = all_chapter_fingerprints[content_hash]
            issues.append((nid, fn, f'EXACT_DUPLICATE: identical to {other_nid}/{other_fn}'))
        all_chapter_fingerprints[content_hash] = (nid, fn)

        # 3. Check for near-duplicate with previous chapter
        if prev_content is not None:
            # Compare using normalized content
            prev_norm = re.sub(r'[\s\n\r]+', '', prev_content)
            curr_norm = normalized
            if len(prev_norm) > 0 and len(curr_norm) > 0:
                # Simple similarity: count common 20-char substrings
                common = 0
                for i in range(0, len(prev_norm) - 20, 100):
                    substr = prev_norm[i:i+20]
                    if substr in curr_norm:
                        common += 1
                if common > 10:  # High overlap
                    issues.append((nid, fn, f'HIGH_OVERLAP: {common} common 20-char segments with {prev_fn}'))

        prev_content = text
        prev_fn = fn

        # 4. Check for chapters with content that looks like error messages
        error_patterns = [
            r'Error\s*\d{3}',
            r'Traceback\s*\(most recent call last\)',
            r'HTTPError|ConnectionError|TimeoutError',
            r'API\s*key\s*is\s*invalid',
            r'rate\s*limit',
            r'token\s*limit',
            r'max.*tokens?',
            r'content\s*filter',
            r'I\'m sorry|I cannot|作为AI|我是一个',
            r'```python|```json|```html',
            r'\\n\\n|\\t\\t',  # literal escape sequences in text
        ]
        for pat in error_patterns:
            matches = re.findall(pat, text, re.IGNORECASE)
            if matches:
                issues.append((nid, fn, f'ERROR_PATTERN: "{pat}" found {len(matches)} times: {matches[:2]}'))

        # 5. Check for chapters that end very abruptly (mid-sentence)
        last_line = [l.strip() for l in text.split('\n') if l.strip()][-1] if text.strip() else ''
        if last_line and len(last_line) > 5:
            # Check if last line ends with punctuation
            if not re.search(r'[。！？…—」』"]$', last_line):
                # Might be truncated - but this is common in novels, so only flag if very short
                if cn_chars < 2000:
                    issues.append((nid, fn, f'ABRUPT_END: last line "{last_line[-40:]}" (no ending punctuation, {cn_chars} cn chars)'))

        # 6. Check for very short chapters (< 1000 Chinese chars = likely incomplete)
        if cn_chars < 1000:
            issues.append((nid, fn, f'SHORT_CHAPTER: only {cn_chars} Chinese characters'))

print(f'\n\n========== RESULTS ==========')
print(f'Found {len(issues)} issues\n')
for nid, fn, issue in issues:
    print(f'{nid}/{fn}: {issue}')
if not issues:
    print('No issues found.')