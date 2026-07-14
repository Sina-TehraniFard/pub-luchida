import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { http } from '@/api/http'
import type { LogEntry } from '@/types/api'

interface Props {
  onLog: (entry: LogEntry) => void
  onSynced: () => void
}

export default function SyncButton({ onLog, onSynced }: Props) {
  const [loading, setLoading] = useState(false)

  const handleSync = async () => {
    setLoading(true)
    onLog({ timestamp: new Date().toISOString(), message: 'GMO同期中...', type: 'info' })

    try {
      const { data } = await http.post('/sync', {})
      onLog({
        timestamp: new Date().toISOString(),
        message: `同期完了: DB=${data.dbOpen}件 GMO=${data.gmoOpen}件 更新=${data.synced}件`,
        type: data.synced > 0 ? 'success' : 'info',
      })
      onSynced()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      onLog({ timestamp: new Date().toISOString(), message: `同期失敗: ${message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleSync}
      disabled={loading}
      variant="outline"
      className="font-medium"
    >
      {loading ? '同期中...' : 'GMO同期'}
    </Button>
  )
}
