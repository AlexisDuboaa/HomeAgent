import { Sparkles } from 'lucide-react'
import type { HueScene, HueGroup } from '../types/hue'
import { useHue } from '../context/HueContext'

interface Props {
  scene: HueScene
  group?: HueGroup
}

const SCENE_COLORS: Record<string, string> = {
  Relax: '#FFB347',
  Read: '#FFF5E0',
  Concentrate: '#60A5FA',
  Energize: '#34D399',
  Bright: '#FFFFFF',
  Dimmed: '#888899',
  Nightlight: '#FF6B35',
  Rest: '#A78BFA',
}

function getSceneColor(name: string): string {
  for (const [key, color] of Object.entries(SCENE_COLORS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return color
  }
  // Derive a color from name hash
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 70%, 60%)`
}

export default function SceneCard({ scene, group }: Props) {
  const { activateScene } = useHue()
  const color = getSceneColor(scene.name)

  const handleActivate = () => {
    if (group) {
      activateScene(group.id, scene.id)
    }
  }

  return (
    <button
      onClick={handleActivate}
      className="flex items-center gap-3 w-full bg-bg-card hover:bg-bg-hover rounded-2xl p-4 transition-all text-left group"
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all group-hover:scale-110"
        style={{ background: `${color}25` }}
      >
        <Sparkles size={16} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{scene.name}</p>
        {group && <p className="text-xs text-text-secondary mt-0.5">{group.name}</p>}
      </div>
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
    </button>
  )
}
