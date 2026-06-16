import { NavLink } from 'react-router-dom'

const navItems = [
  // 总览
  { to: 'dashboard', label: '仪表盘', icon: '📊' },
  { to: 'stats', label: '统计', icon: '📈' },
  // 内容
  { to: 'chapters', label: '章节', icon: '📖' },
  { to: 'outline', label: '大纲', icon: '📋' },
  { to: 'characters', label: '角色', icon: '👤' },
  { to: 'graph', label: '关系图', icon: '🕸️' },
  { to: 'world', label: '世界', icon: '🌍' },
  // AI 工具
  { to: 'chat', label: '对话', icon: '💬' },
  { to: 'auto-write', label: '自动写作', icon: '🤖' },
  { to: 'style', label: '风格', icon: '🎨' },
  // 管理
  { to: 'truth', label: '真相文件', icon: '📄' },
  { to: 'foreshadowing', label: '伏笔', icon: '🔗' },
  { to: 'history', label: '版本历史', icon: '🕐' },
  { to: 'workflow', label: '工作流', icon: '⚙️' },
  // 系统
  { to: 'tools', label: '工具箱', icon: '🧰' },
  { to: 'search', label: '搜索', icon: '🔍' },
  { to: 'export', label: '导出', icon: '📦' },
  { to: 'settings', label: '设置', icon: '🔧' },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>OpenWrite</h2>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
