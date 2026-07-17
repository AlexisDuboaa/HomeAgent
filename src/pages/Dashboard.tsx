import { useMemo } from 'react'
import { Search, Bell, Lightbulb, Home, Palette, RefreshCw } from 'lucide-react'
import { useHue } from '../context/HueContext'
import LightCard from '../components/LightCard'
import RoomCard from '../components/RoomCard'
import SceneCard from '../components/SceneCard'
import { briToPercent } from '../api/hue'

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'Bonne nuit'
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

export default function Dashboard() {
  const { lights, groups, scenes, loading, refresh } = useHue()

  const activeLights = useMemo(
    () => lights.filter((l) => l.state.on && l.state.reachable),
    [lights]
  )
  const avgBri = useMemo(() => {
    if (activeLights.length === 0) return 0
    return Math.round(
      activeLights.reduce((acc, l) => acc + briToPercent(l.state.bri), 0) / activeLights.length
    )
  }, [activeLights])

  // Show max 3 cards on dashboard
  const featuredLights = useMemo(() => lights.slice(0, 6), [lights])
  const featuredScenes = useMemo(
    () => scenes.filter((s) => s.type === 'GroupScene' && s.group).slice(0, 5),
    [scenes]
  )

  const stats = [
    { label: 'Lampes actives', value: activeLights.length, color: '#FFB347', icon: Lightbulb },
    { label: 'Pièces', value: groups.length, color: '#60A5FA', icon: Home },
    { label: 'Scènes', value: scenes.length, color: '#A78BFA', icon: Palette },
    { label: 'Luminosité moy.', value: `${avgBri}%`, color: '#34D399', icon: Lightbulb },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-8 h-[72px] shrink-0">
        <div>
          <h1 className="text-[22px] font-bold text-white">{getGreeting()} 👋</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {activeLights.length} lampes actives · {groups.length} pièces
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-bg-card rounded-xl px-4 h-9 w-48">
            <Search size={15} className="text-text-secondary shrink-0" />
            <span className="text-sm text-text-secondary">Rechercher...</span>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="w-9 h-9 bg-bg-card rounded-xl flex items-center justify-center text-text-secondary hover:text-white transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className="w-9 h-9 bg-bg-card rounded-xl flex items-center justify-center text-text-secondary hover:text-white transition-colors">
            <Bell size={16} />
          </button>
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent-orange to-accent-orange-dark" />
        </div>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {stats.map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="bg-bg-card rounded-2xl p-5">
              <Icon size={18} style={{ color }} />
              <p className="text-2xl font-bold mt-2" style={{ color }}>
                {value}
              </p>
              <p className="text-xs text-text-secondary mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Main grid */}
        <div className="flex gap-6">
          {/* Left – Lights */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Rooms */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg text-white">Pièces</h2>
                <a href="/rooms" className="text-[13px] text-accent-orange hover:underline">
                  Tout voir →
                </a>
              </div>
              {groups.length === 0 && !loading ? (
                <p className="text-sm text-text-secondary">Aucune pièce configurée.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {groups.slice(0, 4).map((group) => (
                    <RoomCard key={group.id} group={group} />
                  ))}
                </div>
              )}
            </section>

            {/* Individual lights */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg text-white">Lampes</h2>
                <a href="/lights" className="text-[13px] text-accent-orange hover:underline">
                  Tout voir →
                </a>
              </div>
              {featuredLights.length === 0 && !loading ? (
                <p className="text-sm text-text-secondary">Aucune lampe trouvée.</p>
              ) : (
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {featuredLights.map((light) => (
                    <LightCard key={light.id} light={light} />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right – Scenes */}
          <aside className="w-72 shrink-0 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg text-white">Scènes rapides</h2>
              <a href="/scenes" className="text-[13px] text-accent-orange hover:underline">
                Tout voir →
              </a>
            </div>
            {featuredScenes.length === 0 && !loading ? (
              <p className="text-sm text-text-secondary">Aucune scène disponible.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {featuredScenes.map((scene) => {
                  const group = groups.find((g) => g.id === scene.group)
                  return <SceneCard key={scene.id} scene={scene} group={group} />
                })}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
