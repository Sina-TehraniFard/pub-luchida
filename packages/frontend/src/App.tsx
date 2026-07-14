import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import Dashboard from '@/pages/Dashboard'
import SmaChartPage from '@/pages/SmaChartPage'
import Forecast from '@/pages/Forecast'
import EntryLog from '@/pages/EntryLog'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/entry-log" element={<EntryLog />} />
          <Route path="/chart" element={<SmaChartPage />} />
          <Route path="/forecast" element={<Forecast />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
