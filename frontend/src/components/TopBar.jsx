import { useState, useEffect } from 'react';
import { Bell, Zap } from 'lucide-react';

export default function TopBar({ onInjectClick }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTime = time.toLocaleTimeString('en-GB', { hour12: false });

  return (
    <header className="topbar">
      {/* System Status Indicator */}
      <div className="topbar__left">
        <div className="online-badge">
          <span className="online-dot" />
          <span>System Online</span>
        </div>
      </div>

      {/* Action Controls & Clock */}
      <div className="topbar__right">
        <button className="inject-btn" onClick={onInjectClick}>
          <Zap style={{ width: 14, height: 14, fill: 'currentColor' }} />
          <span>Inject Fault</span>
        </button>

        <button className="icon-btn" aria-label="Notifications">
          <Bell style={{ width: 18, height: 18 }} />
          <span className="notification-dot" />
        </button>

        <div className="clock-display">
          <span>{formattedTime}</span>
        </div>
      </div>
    </header>
  );
}
