"""Content quality scan v3: Accurate detection of real issues."""
import os, re, sys, hashlib
from collections import defaultdict

novels_dir = os.path.join(os.path.dirname(__file__), 'data', 'novels')
novel_ids = ['farm_ancient', 'rebirth_sweet', 'system_urban']
novel_names = {
    'farm_ancient': '穿到边关种田去',
    'rebirth_sweet': '醒来成了他的白月光',
    'system_urban': '我有一个摆烂系统',
}

issues = []

def get_char_count(text):
    """Count Chinese characters only."""
    return len(re.findall(r'[\u4e00-\u9fff]', text))

def check_encoding(filepath):
    """Check for encoding issues: replacement chars, null bytes, BOM issues."""
    found = []
    try:
        with open(filepath, 'rb') as f:
            raw = f.read()
        # Check for UTF-8 BOM
        if raw.startswith(b'\xef\xbb\xbf'):
            found.append(('编码', '文件包含UTF-8 BOM标记'))
        # Check for replacement character U+FFFD
        if b'\xef\xbf\xbd' in raw:
            found.append(('编码', '包含Unicode替换字符U+FFFD（乱码标志）'))
        # Check for null bytes
        if b'\x00' in raw:
            found.append(('编码', '包含空字节(null byte)'))
        # Check for other non-UTF-8 sequences
        try:
            raw.decode('utf-8')
        except UnicodeDecodeError as e:
            found.append(('编码', f'UTF-8解码错误: {str(e)[:80]}'))
        # Check for C1 control characters (U+0080-U+009F) which are invalid in UTF-8 text
        text = raw.decode('utf-8', errors='replace')
        for i, ch in enumerate(text):
            if '\u0080' <= ch <= '\u009f':
                found.append(('编码', f'位置{i}包含C1控制字符U+{ord(ch):04X}'))
                break
    except Exception as e:
        found.append(('编码', f'读取错误: {str(e)[:80]}'))
    return found

def check_garbled(filepath):
    """Check for garbled text patterns typical of encoding corruption."""
    found = []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            text = f.read()
        lines = text.split('\n')
        # Pattern 1: Lines with high ratio of non-standard chars (mojibake)
        for i, line in enumerate(lines, 1):
            line_stripped = line.strip()
            if not line_stripped or line_stripped.startswith('#'):
                continue
            # Check for sequences of garbled chars (e.g., Ã©Â¢Â« type patterns)
            if re.search(r'[À-ÿ]{3,}', line_stripped):
                found.append(('乱码', f'行{i}: 疑似编码损坏片段'))
            # Check for excessive punctuation without content
            cn_chars = get_char_count(line_stripped)
            if cn_chars > 10:
                punct_count = len(re.findall(r'[，。！？、；：""''（）【】…—]', line_stripped))
                if punct_count / cn_chars > 0.6:
                    found.append(('乱码', f'行{i}: 标点比例异常({punct_count}/{cn_chars})'))
        # Pattern 2: Repeated identical paragraphs
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip() and not p.strip().startswith('#')]
        seen = {}
        for p in paragraphs:
            if len(p) < 20:
                continue
            h = hashlib.md5(p.encode()).hexdigest()
            if h in seen:
                found.append(('重复', f'完全重复段落(与行{seen[h]}相同): {p[:40]}...'))
            else:
                seen[h] = paragraphs.index(p) + 1
    except Exception as e:
        found.append(('乱码', f'检查错误: {str(e)[:80]}'))
    return found

def check_short_chapters(filepath, novel_id, ch_id):
    """Check for abnormally short chapters."""
    found = []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            text = f.read()
        cn_count = get_char_count(text)
        # Chapters under 500 Chinese chars are suspicious
        if cn_count < 500:
            found.append(('过短', f'章节仅{cn_count}字，疑似截断或不完整'))
        elif cn_count < 1000:
            found.append(('偏短', f'章节仅{cn_count}字，偏短'))
    except:
        pass
    return found

def check_ai_artifacts(filepath):
    """Check for AI generation artifacts that shouldn't be in final text."""
    found = []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            text = f.read()
        lines = text.split('\n')
        # Pattern: Meta-instructions like "Note:", "Chapter summary:", etc.
        ai_patterns = [
            (r'^\s*(Note|Summary|Chapter \d+ summary|作者注|注：|备注)[：:]', 'AI元数据残留'),
            (r'^\s*\[.*?\]\s*$', '方括号标记（可能是AI指令残留）'),
            (r'(?:作为AI|作为一个人工智能|我无法|I cannot|As an AI)', 'AI自我声明'),
            (r'(?:TODO|FIXME|HACK|XXX)[：:]', '开发标记残留'),
            (r'```[\s\S]*?```', '代码块残留'),
        ]
        for i, line in enumerate(lines, 1):
            for pattern, desc in ai_patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    found.append(('AI残留', f'行{i}: {desc}: {line.strip()[:60]}'))
    except:
        pass
    return found

def check_cross_chapter_consistency(novel_id, chapters_dir):
    """Check for adjacent chapters with very high text overlap (copy-paste error)."""
    found = []
    try:
        files = sorted([f for f in os.listdir(chapters_dir) if f.endswith('.md')])
        for idx in range(len(files) - 1):
            f1 = os.path.join(chapters_dir, files[idx])
            f2 = os.path.join(chapters_dir, files[idx + 1])
            with open(f1, 'r', encoding='utf-8') as f:
                t1 = f.read()
            with open(f2, 'r', encoding='utf-8') as f:
                t2 = f.read()
            # Check if chapters are near-identical
            if len(t1) > 100 and len(t2) > 100:
                # Use normalized comparison
                s1 = set(t1.split())
                s2 = set(t2.split())
                if s1 and s2:
                    overlap = len(s1 & s2) / min(len(s1), len(s2))
                    if overlap > 0.95:
                        found.append(('重复章节', f'{files[idx]}与{files[idx+1]}内容重叠率{overlap:.1%}，疑似复制粘贴'))
    except:
        pass
    return found

# Main scan
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

print("=" * 60)
print("小说内容质量扫描 v3")
print("=" * 60)

for nid in novel_ids:
    mdir = os.path.join(novels_dir, nid, 'data', 'manuscript', 'arc_001')
    if not os.path.exists(mdir):
        print(f"\n[{novel_names[nid]}] 目录不存在: {mdir}")
        continue

    print(f"\n{'='*40}")
    print(f"扫描: {novel_names[nid]} ({nid})")
    print(f"{'='*40}")

    novel_issues = []
    files = sorted([f for f in os.listdir(mdir) if f.endswith('.md')])

    for fname in files:
        filepath = os.path.join(mdir, fname)
        ch_id = fname.replace('.md', '')

        # Run all checks
        problems = []
        problems.extend(check_encoding(filepath))
        problems.extend(check_garbled(filepath))
        problems.extend(check_short_chapters(filepath, nid, ch_id))
        problems.extend(check_ai_artifacts(filepath))

        if problems:
            for p_type, p_desc in problems:
                novel_issues.append((fname, p_type, p_desc))
                print(f"  [{p_type}] {fname}: {p_desc}")

    # Cross-chapter consistency check
    cross_issues = check_cross_chapter_consistency(nid, mdir)
    for p_type, p_desc in cross_issues:
        novel_issues.append(('', p_type, p_desc))
        print(f"  [{p_type}] {p_desc}")

    if not novel_issues and not cross_issues:
        print(f"  ✓ 未发现问题")
    else:
        print(f"\n  共发现 {len(novel_issues)} 个问题")

    issues.extend([(nid, *i) for i in novel_issues])

# Summary
print(f"\n{'='*60}")
print(f"扫描总结")
print(f"{'='*60}")
if issues:
    print(f"共发现 {len(issues)} 个问题:")
    by_type = defaultdict(list)
    for nid, fname, ptype, pdesc in issues:
        by_type[ptype].append((novel_names[nid], fname, pdesc))
    for ptype, items in sorted(by_type.items()):
        print(f"\n  [{ptype}] ({len(items)}个):")
        for nname, fname, pdesc in items:
            print(f"    {nname}/{fname}: {pdesc}")
else:
    print("✓ 三篇小说均未发现内容质量问题")

print(f"\n扫描完成。")