import { Lightbulb, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { HueGroup } from '../types/hue'
import { useHue } from '../context/HueContext'
import { briToPercent } from '../api/hue'

interface Props {
  group: HueGroup
  onClick?: () => void
}

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

export default function RoomCard({ group, onClick }: Props) {
  const navigate = useNavigate()
  const { toggleGroup, lights } = useHue()
  const handleClick = onClick ?? (() => navigate(`/rooms/${group.id}`))
  const roomLights = lights.filter((l) => l.roomId === group.id)
  const activeLights = roomLights.filter((l) => l.state.on && l.state.reachable)
  const avgBri =
    activeLights.length > 0
      ? Math.round(
          activeLights.reduce((acc, l) => acc + briToPercent(l.state.bri), 0) / activeLights.length
        )
      : 0

  const isAnyOn = group.state.any_on
  const icon = ROOM_ICONS[group.class ?? ''] ?? '💡'

  return (
    <div
      className="bg-bg-card rounded-2xl p-4 flex flex-col gap-3 cursor-pointer hover:bg-bg-hover transition-all"
      onClick={handleClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{ background: isAnyOn ? '#FFB34720' : '#2E2E3F' }}
          >
            {icon}
          </div>
          <div>
            <p className="font-semibold text-white text-sm">{group.name}</p>
            <p className="text-xs text-text-secondary mt-0.5">
              {activeLights.length}/{roomLights.length} lampes actives
            </p>
          </div>
        </div>
        <ChevronRight size={16} className="text-text-muted mt-1" />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb size={14} className={isAnyOn ? 'text-accent-orange' : 'text-text-muted'} />
          <span className="text-xs text-text-secondary">
            {isAnyOn ? `${avgBri}% moy.` : 'Éteint'}
          </span>
        </div>

        {/* Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleGroup(group.id, !isAnyOn)
          }}
          className="relative w-11 h-6 rounded-full transition-all"
          style={{ background: isAnyOn ? '#FFB347' : '#2E2E3F' }}
        >
          <span
            className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
            style={{ left: isAnyOn ? 'calc(100% - 20px)' : '4px' }}
          />
        </button>
      </div>
    </div>
  )
}
