import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lightbulb, Sparkles, SlidersHorizontal, Power } from 'lucide-react'
import { useHue } from '../context/HueContext'
import LightCard from '../components/LightCard'
import SceneCard from '../components/SceneCard'
import { briToPercent, percentToBri } from '../api/hue'

const ROOM_ICONS: Record<string, string> = {
  'Living room': '🛋️',
  Kitchen: '🍳',
  Bedroom: '🛏️',
  Bathroom: '🚿',
  Office: '💻',
  'Dining room': '🍽️',
  Hallway: '🚪',
  Garage: '🚗',
  Garden: '🌿',
  Terrace: '☀️',
}

export default function RoomDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { groups, lights, scenes, toggleGroup, updateGroup } = useHue()

  const group = useMemo(() => groups.find((g) => g.id === id), [groups, id])
  const roomLights = useMemo(() => lights.filter((l) => l.roomId === id), [lights, id])
  const roomScenes = useMemo(
    () => scenes.filter((s) => s.type === 'GroupScene' && s.group === id),
    [scenes, id]
  )
  const activeLights = useMemo(
    () => roomLights.filter((l) => l.state.on && l.state.reachable),
    [roomLights]
  )
  const avgBri = useMemo(() => {
    if (activeLights.length === 0) return 0
    return Math.round(
      activeLights.reduce((acc, l) => acc + briToPercent(l.state.bri), 0) / activeLights.length
    )
  }, [activeLights])

  const [groupBri, setGroupBri] = useState(avgBri)

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-text-secondary">Pièce introuvable.</p>
        <button onClick={() => navigate(-1)} className="text-accent-orange hover:underline text-sm">
          ← Retour
        </button>
      </div>
    )
  }

  const isAnyOn = group.state.any_on
  const icon = ROOM_ICONS[group.class ?? ''] ?? '💡'

  const handleGroupBriChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGroupBri(Number(e.target.value))
  }

  const handleGroupBriCommit = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const val = Number(e.currentTarget.value)
    setGroupBri(val)
    updateGroup(group.id, { bri: percentToBri(val), on: val > 0 })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="px-8 pt-7 pb-5 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-text-secondary hover:text-white transition-colors mb-5 text-sm"
        >
          <ArrowLeft size={16} />
          Retour
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
              style={{ background: isAnyOn ? '#FFB34720' : '#2E2E3F' }}
            >
              {icon}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{group.name}</h1>
              <p className="text-sm text-text-secondary mt-0.5">
                {activeLights.length}/{roomLights.length} lampes actives
              </p>
            </div>
          </div>

          {/* Global controls */}
          <div className="flex items-center gap-3">
            {/* All-on toggle */}
            <button
              onClick={() => toggleGroup(group.id, !isAnyOn)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                isAnyOn
                  ? 'bg-accent-orange text-white'
                  : 'bg-bg-card text-text-secondary hover:text-white'
              }`}
            >
              <Power size={15} />
              {isAnyOn ? 'Tout éteindre' : 'Tout allumer'}
            </button>
          </div>
        </div>

        {/* Group brightness bar */}
        {isAnyOn && (
          <div className="mt-6 bg-bg-card rounded-2xl p-5 flex items-center gap-5">
            <SlidersHorizontal size={18} className="text-accent-orange shrink-0" />
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">Luminosité globale</span>
                <span className="text-sm font-semibold text-accent-orange">{groupBri}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={groupBri}
                onChange={handleGroupBriChange}
                onMouseUp={handleGroupBriCommit}
                onTouchEnd={handleGroupBriCommit}
                className="w-full"
                style={{
                  background: `linear-gradient(to right, #FFB347 ${groupBri}%, #2E2E3F ${groupBri}%)`,
                }}
              />
            </div>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="flex gap-6">
          {/* Left — Lampes */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-bg-card rounded-2xl p-4">
                <p className="text-xl font-bold text-accent-orange">{roomLights.length}</p>
                <p className="text-xs text-text-secondary mt-0.5">Lampes total</p>
              </div>
              <div className="bg-bg-card rounded-2xl p-4">
                <p className="text-xl font-bold text-accent-green">{activeLights.length}</p>
                <p className="text-xs text-text-secondary mt-0.5">Actives</p>
              </div>
              <div className="bg-bg-card rounded-2xl p-4">
                <p className="text-xl font-bold text-accent-blue">{avgBri}%</p>
                <p className="text-xs text-text-secondary mt-0.5">Lum. moy.</p>
              </div>
            </div>

            {/* Lights grid */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Lightbulb size={16} className="text-accent-orange" />
                <h2 className="font-bold text-base text-white">Lampes</h2>
              </div>
              {roomLights.length === 0 ? (
                <p className="text-sm text-text-secondary">Aucune lampe dans cette pièce.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {roomLights.map((light) => (
                    <LightCard key={light.id} light={light} />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right — Scenes */}
          <aside className="w-64 shrink-0 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-accent-purple" />
              <h2 className="font-bold text-base text-white">Scènes</h2>
            </div>
            {roomScenes.length === 0 ? (
              <p className="text-sm text-text-secondary">Aucune scène pour cette pièce.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {roomScenes.map((scene) => (
                  <SceneCard key={scene.id} scene={scene} group={group} />
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
