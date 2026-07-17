import { NavLink } from 'react-router-dom'
import { Home, Lightbulb, Palette, Timer, Settings, Zap, LayoutGrid } from 'lucide-react'

const navItems = [
  { to: '/', icon: Home, label: 'Accueil' },
  { to: '/rooms', icon: LayoutGrid, label: 'Pièces' },
  { to: '/lights', icon: Lightbulb, label: 'Lumières' },
  { to: '/scenes', icon: Palette, label: 'Scènes' },
  { to: '/routines', icon: Timer, label: 'Routines' },
  { to: '/settings', icon: Settings, label: 'Paramètres' },
]

export default function Sidebar() {
  return (
    <aside className="flex flex-col w-60 min-h-screen bg-bg-sidebar shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 h-[72px]">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-orange to-accent-orange-dark flex items-center justify-center shrink-0">
          <Zap size={16} className="text-white" />
        </div>
        <span className="font-bold text-base text-white">Hue Dashboard</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-3 py-2 flex-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 h-11 rounded-xl transition-all text-sm font-medium ${
                isActive
                  ? 'bg-white/[0.07] text-accent-orange'
                  : 'text-text-secondary hover:bg-white/[0.04] hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} className={isActive ? 'text-accent-orange' : ''} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 pb-6">
        <div className="rounded-xl bg-bg-card p-3">
          <p className="text-xs text-text-secondary">Bridge connecté</p>
          <p className="text-xs font-medium text-text-primary mt-0.5 truncate">192.168.1.x</p>
          <div className="mt-2 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
            <span className="text-xs text-accent-green">En ligne</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
