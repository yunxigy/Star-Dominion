"""Fix AI generation loop chapters by trimming repeated content."""
import os
import shutil
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

novels_dir = os.path.join(os.path.dirname(__file__), 'data', 'novels')

# Define the fix plan: each entry is (novel_id, chapter_file, keep_lines, reason)
fixes = [
    # ch_008: Lines 1-421 are the original story (Day 1 + Day 2).
    # Line 423 starts "第二天" loop repeating the same daily pattern.
    # The original ends with "这一晚，她又睡得很沉，没有做梦。" (line 421)
    (
        'rebirth_sweet',
        'ch_008.md',
        421,
        'AI生成循环：第422行起重复"第二天到教室"场景模式11次，分数从89→102→115...→150无限递增'
    ),
    # ch_028: Lines 1-381 are original (赵明远律师函→记者采访→周明远电话→张伟排班系统→第二个记者).
    # Line 383 starts loop: 赵明远再次进来 with same dialogue pattern.
    # The original ends with "陈默满意地点点头。" after second reporter rejection (line 381)
    (
        'system_urban',
        'ch_028.md',
        381,
        'AI生成循环：第382行起重复"某人进门→问题→摆烂应对→系统通知→周明远电话→差点露馅"模式'
    ),
    # ch_094: Lines 1-551 are original (地铁→老太太→烤红薯→王振华→公司→技术峰会任务→摆烂连锁).
    # Line 553 starts loop: system triggers new tasks, repetitive "也许，这就是..." patterns.
    # The original ends with "不是躺平，不是放弃，而是知道什么重要，什么不重要。" (line 551)
    (
        'system_urban',
        'ch_094.md',
        551,
        'AI生成循环：第552行起重复"也许，这就是生活/摆烂的尊严/摆烂连锁"模式，系统任务循环触发'
    ),
]

def fix_chapter(novel_id, chapter_file, keep_lines, reason):
    filepath = os.path.join(novels_dir, novel_id, 'data', 'manuscript', 'arc_001', chapter_file)
    backup_path = filepath + '.bak'

    if not os.path.exists(filepath):
        print(f"  [跳过] 文件不存在: {filepath}")
        return False

    # Read original
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    original_count = len(lines)

    if original_count <= keep_lines:
        print(f"  [跳过] {chapter_file}: 行数({original_count})<=保留行数({keep_lines})，无需修复")
        return False

    # Create backup
    shutil.copy2(filepath, backup_path)
    print(f"  [备份] {chapter_file} -> {chapter_file}.bak")

    # Trim
    kept_lines = lines[:keep_lines]

    # Ensure the file ends with a newline
    if kept_lines and not kept_lines[-1].endswith('\n'):
        kept_lines[-1] += '\n'

    # Write trimmed version
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(kept_lines)

    trimmed_count = original_count - keep_lines
    print(f"  [修复] {chapter_file}: {original_count}行 → {keep_lines}行 (删除{trimmed_count}行重复内容)")
    print(f"  [原因] {reason}")
    return True

def main():
    print("=" * 60)
    print("修复AI生成循环章节")
    print("=" * 60)

    fixed = 0
    for novel_id, chapter_file, keep_lines, reason in fixes:
        print(f"\n处理 {novel_id}/{chapter_file}...")
        if fix_chapter(novel_id, chapter_file, keep_lines, reason):
            fixed += 1

    print(f"\n{'=' * 60}")
    print(f"修复完成: {fixed}/{len(fixes)} 个章节已修复")
    print(f"备份文件: *.bak (可手动恢复)")
    print(f"{'=' * 60}")

if __name__ == '__main__':
    main()