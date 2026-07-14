import type { LogEntry } from '@/types/api'

interface Props {
  logs: LogEntry[]
}

const typeColor = {
  info: 'text-muted-foreground',
  success: 'text-emerald-400',
  error: 'text-red-400',
}

export default function ActivityLog({ logs }: Props) {
  if (logs.length === 0) {
    return <p className="text-muted-foreground text-sm italic">ログなし</p>
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
      {logs.map((log, i) => (
        <div key={i} className={typeColor[log.type]}>
          <span className="text-muted-foreground/60">
            [{new Date(log.timestamp).toLocaleTimeString('ja-JP')}]
          </span>{' '}
          {log.message}
        </div>
      ))}
    </div>
  )
}
