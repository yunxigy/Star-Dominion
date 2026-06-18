import { NavLink } from 'react-router-dom'

const navItems = [
  { to: 'dashboard', label: '仪表盘', icon: '📊' },
  { to: 'chapters', label: '章节', icon: '📖' },
  { to: 'worldview', label: '世界观', icon: '🌍' },
  { to: 'foreshadowing', label: '伏笔', icon: '🔗' },
  { to: 'ai', label: 'AI 助手', icon: '💬' },
  { to: 'workflow', label: '工作流', icon: '⚙️' },
  { to: 'tools', label: '工具箱', icon: '🧰' },
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
