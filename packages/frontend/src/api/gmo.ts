import axios from 'axios'
import type { GmoTickerData } from '@/types/api'

const gmoPublic = axios.create({
  baseURL: '/gmo-public',
  timeout: 5_000,
})

export async function fetchTicker(symbol: string): Promise<GmoTickerData | null> {
  try {
    const { data } = await gmoPublic.get('/v1/ticker', { params: { symbol } })
    const item = data?.data?.[0]
    return item ?? null
  } catch {
    return null
  }
}

export interface KlineData {
  openTime: string
  open: string
  high: string
  low: string
  close: string
}

export async function fetchKlines(symbol: string, interval: string, date: string): Promise<KlineData[]> {
  try {
    const { data } = await gmoPublic.get('/v1/klines', {
      params: { symbol, priceType: 'BID', interval, date },
    })
    return data?.data ?? []
  } catch {
    return []
  }
}
