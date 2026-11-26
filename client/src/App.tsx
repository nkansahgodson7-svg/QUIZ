import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { dismissBootSplash } from './lib/boot-splash'
import { LandingPage } from './pages/LandingPage'
import { HostPage } from './pages/HostPage'
import { PlayerPage } from './pages/PlayerPage'

// Invite links can be shared as /join?code=…; keep /play as the one player route.
function JoinAlias() {
  const { search } = useLocation()
  return <Navigate to={`/play${search}`} replace />
}

export default function App() {
  // The splash lives in index.html so it paints before this bundle loads.
  useEffect(() => {
    dismissBootSplash()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/play" element={<PlayerPage />} />
        <Route path="/join" element={<JoinAlias />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
