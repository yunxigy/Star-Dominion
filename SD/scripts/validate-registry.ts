/**
 * 工具注册表校验脚本
 * 运行: npx tsx scripts/validate-registry.ts
 */
import { TOOLS, CATEGORIES } from '../tools/registry';
import { ICON_MAP } from '../lib/iconMap';

const errors: string[] = [];
const warnings: string[] = [];

// 1. 检查工具 ID 唯一性
const ids = new Set<string>();
TOOLS.forEach(tool => {
  if (ids.has(tool.id)) {
    errors.push(`重复的工具 ID: "${tool.id}"`);
  }
  ids.add(tool.id);
});

// 2. 检查分类 ID 合法性
const categoryIds = new Set(CATEGORIES.map(c => c.id));
TOOLS.forEach(tool => {
  if (!categoryIds.has(tool.category)) {
    errors.push(`工具 "${tool.id}" 的分类 "${tool.category}" 不在 CATEGORIES 中`);
  }
});

// 3. 检查图标 ID 合法性
TOOLS.forEach(tool => {
  if (!(tool.icon in ICON_MAP)) {
    errors.push(`工具 "${tool.id}" 的图标 "${tool.icon}" 不在 ICON_MAP 中`);
  }
});

// 4. 检查必填字段
TOOLS.forEach(tool => {
  if (!tool.name) warnings.push(`工具 "${tool.id}" 缺少 name`);
  if (!tool.description) warnings.push(`工具 "${tool.id}" 缺少 description`);
  if (!tool.gradient) warnings.push(`工具 "${tool.id}" 缺少 gradient`);
  if (!tool.glow) warnings.push(`工具 "${tool.id}" 缺少 glow`);
});

// 5. 检查 CATEGORIES 中的图标
CATEGORIES.forEach(cat => {
  if (!(cat.icon in ICON_MAP)) {
    errors.push(`分类 "${cat.id}" 的图标 "${cat.icon}" 不在 ICON_MAP 中`);
  }
});

// 6. 检查颜色值合法
const validColors = ['red', 'emerald', 'violet', 'amber', 'cyan', 'pink', 'blue', 'lime', 'indigo'];
TOOLS.forEach(tool => {
  if (!validColors.includes(tool.color)) {
    errors.push(`工具 "${tool.id}" 的颜色 "${tool.color}" 不合法`);
  }
});

// 输出结果
console.log('=== 工具注册表校验 ===\n');
console.log(`工具总数: ${TOOLS.length}`);
console.log(`分类总数: ${CATEGORIES.length}`);

if (errors.length === 0 && warnings.length === 0) {
  console.log('\n✅ 校验通过，没有问题');
} else {
  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} 个错误:`);
    errors.forEach(e => console.log(`  - ${e}`));
  }
  if (warnings.length > 0) {
    console.log(`\n⚠️ ${warnings.length} 个警告:`);
    warnings.forEach(w => console.log(`  - ${w}`));
  }
  process.exit(errors.length > 0 ? 1 : 0);
}
