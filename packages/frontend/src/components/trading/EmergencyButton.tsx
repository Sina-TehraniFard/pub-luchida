import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { http } from '@/api/http'
import type { LogEntry } from '@/types/api'

interface Props {
  onLog: (entry: LogEntry) => void
  onClosed: () => void
}

export default function EmergencyButton({ onLog, onClosed }: Props) {
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const handleClick = async () => {
    if (!confirm) {
      setConfirm(true)
      setTimeout(() => setConfirm(false), 3000)
      return
    }

    setLoading(true)
    setConfirm(false)
    onLog({ timestamp: new Date().toISOString(), message: '緊急全決済を実行中...', type: 'error' })

    try {
      const { data } = await http.post('/emergency-close-all', {})
      onLog({
        timestamp: new Date().toISOString(),
        message: `緊急全決済完了: ${data.closed}件決済`,
        type: data.closed > 0 ? 'error' : 'info',
      })
      onClosed()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      onLog({ timestamp: new Date().toISOString(), message: `緊急全決済失敗: ${message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      variant="destructive"
      className={`font-bold px-6 ${confirm ? 'animate-pulse bg-red-700' : ''}`}
    >
      {loading ? '決済中...' : confirm ? '本当に全決済する？' : '緊急全決済'}
    </Button>
  )
}
