import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { HueProvider, useHue } from './context/HueContext'
import Sidebar from './components/Sidebar'
import SetupModal from './components/SetupModal'
import Dashboard from './pages/Dashboard'
import Lights from './pages/Lights'
import Scenes from './pages/Scenes'
import Routines from './pages/Routines'
import Settings from './pages/Settings'
import Rooms from './pages/Rooms'
import RoomDetail from './pages/RoomDetail'

function AppShell() {
  const { config } = useHue()

  return (
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      {!config && <SetupModal />}
      <Sidebar />
      <main className="flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/lights" element={<Lights />} />
          <Route path="/scenes" element={<Scenes />} />
          <Route path="/routines" element={<Routines />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/rooms" element={<Rooms />} />
          <Route path="/rooms/:id" element={<RoomDetail />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <HueProvider>
        <AppShell />
      </HueProvider>
    </BrowserRouter>
  )
}
