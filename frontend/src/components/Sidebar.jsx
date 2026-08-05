import {
  Zap,
  LayoutDashboard,
  Map,
  Activity,
  FlaskConical,
  Settings,
  Sun,
  Moon,
  User,
  ChevronDown,
} from 'lucide-react';

export default function Sidebar({
  activeNav,
  onNavSelect,
  theme,
  onToggleTheme,
  wsStatus,
}) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'map', label: 'Live Map', icon: Map },
    { id: 'telemetry', label: 'Telemetry', icon: Activity },
    { id: 'simulator', label: 'Simulator', icon: FlaskConical },
    { id: 'settings', label: 'Settings & AI', icon: Settings },
  ];

  return (
    <aside className="sidebar">
      {/* Brand & Logo */}
      <div className="sidebar__header">
        <div className="sidebar__logo-icon">
          <Zap className="w-5 h-5 fill-current" />
        </div>
        <div className="sidebar__logo-text">
          <span className="sidebar__title">PowerFault</span>
          <span className="sidebar__subtitle">DETECTION SYSTEM</span>
        </div>
      </div>

      {/* Navigation items */}
      <nav className="sidebar__nav">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavSelect(id)}
            className={`nav-item ${activeNav === id ? 'nav-item--active' : ''}`}
          >
            <Icon className="nav-item__icon" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* Sidebar Footer Controls */}
      <div className="sidebar__footer">
        {/* Theme Mode Switcher */}
        <button className="theme-toggle-btn" onClick={onToggleTheme}>
          <span>Theme Mode</span>
          {theme === 'light' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Sun style={{ width: 14, height: 14, color: '#f59e0b' }} /> Light
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Moon style={{ width: 14, height: 14, color: '#60a5fa' }} /> Dark
            </span>
          )}
        </button>

        {/* Connection Status Pill */}
        {wsStatus === 'connected' ? (
          <div className="connected-pill">
            <span className="status-dot" />
            <span>Connected</span>
          </div>
        ) : (
          <div className="reconnecting-pill">
            <span className="status-dot" />
            <span>Reconnecting...</span>
          </div>
        )}

        {/* Bottom User Section */}
        <div className="user-profile">
          <div className="user-avatar">
            <User style={{ width: 16, height: 16 }} />
          </div>
          <div className="user-info">
            <span className="user-name">Network Operator</span>
            <span className="user-role">Field Supervisor</span>
          </div>
          <ChevronDown style={{ width: 14, height: 14, color: 'var(--txt-muted)' }} />
        </div>
      </div>
    </aside>
  );
}
