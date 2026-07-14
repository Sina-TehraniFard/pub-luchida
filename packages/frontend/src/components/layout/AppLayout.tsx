import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, TrendingUp, LineChart, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Logs' },
  { to: '/entry-log', icon: Filter, label: 'エントリー判定' },
  { to: '/chart', icon: LineChart, label: 'SMA Chart' },
  { to: '/forecast', icon: TrendingUp, label: '予想収益' },
]

export default function AppLayout() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <nav className="w-56 border-r border-border flex flex-col p-4 gap-1">
        <h1 className="text-lg font-bold mb-6 px-3">Luchida</h1>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
