import { useState } from 'react'
import { Lightbulb } from 'lucide-react'
import type { HueLight } from '../types/hue'
import { useHue } from '../context/HueContext'
import { briToPercent, hueStateToColor } from '../api/hue'

interface Props {
  light: HueLight
}

export default function LightCard({ light }: Props) {
  const { toggleLight, setLightBrightness } = useHue()
  const [localBri, setLocalBri] = useState(briToPercent(light.state.bri))
  const color = hueStateToColor(light)
  const isOn = light.state.on && light.state.reachable

  const handleToggle = () => {
    toggleLight(light.id, !light.state.on)
  }

  const handleBrightnessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setLocalBri(val)
  }

  const handleBrightnessCommit = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const val = Number(e.currentTarget.value)
    setLightBrightness(light.id, val)
  }

  if (!light.state.reachable) {
    return (
      <div className="relative bg-bg-card rounded-3xl p-5 flex flex-col gap-3 opacity-40 w-[200px] shrink-0">
        <div className="flex items-center justify-between">
          <Lightbulb size={28} className="text-text-muted" />
          <span className="text-xs text-text-muted bg-white/5 px-2 py-0.5 rounded-full">
            Hors ligne
          </span>
        </div>
        <div className="mt-3">
          <p className="font-bold text-white">{light.name}</p>
          <p className="text-xs text-text-secondary mt-0.5">{light.roomName || 'Non assigné'}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative rounded-3xl p-5 flex flex-col gap-3 w-[200px] shrink-0 transition-all"
      style={{
        background: '#1C1C2A',
        boxShadow: isOn
          ? `0 4px 32px -8px ${color}70, 0 0 0 1px ${color}25`
          : '0 0 0 1px #ffffff08',
      }}
    >
      {/* Color wash — tinted background reflecting bulb color */}
      {isOn && (
        <div
          className="absolute inset-0 rounded-3xl pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 25% 20%, ${color}40 0%, ${color}08 55%, transparent 80%)`,
          }}
        />
      )}

      {/* Top row */}
      <div className="flex items-center justify-between relative">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: isOn ? `${color}30` : '#2E2E3F' }}
        >
          <Lightbulb size={18} style={{ color: isOn ? color : '#555566' }} />
        </div>

        {/* Toggle */}
        <button
          onClick={handleToggle}
          className="relative w-11 h-6 rounded-full transition-all"
          style={{ background: isOn ? color : '#2E2E3F' }}
        >
          <span
            className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
            style={{ left: isOn ? 'calc(100% - 20px)' : '4px' }}
          />
        </button>
      </div>

      {/* Info */}
      <div className="mt-1">
        <p className="font-bold text-white text-[15px] leading-tight">{light.name}</p>
        <p className="text-xs text-text-secondary mt-0.5">{light.roomName || 'Non assigné'}</p>
      </div>

      {/* Brightness */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">Luminosité</span>
          <span className="text-xs font-semibold" style={{ color: isOn ? color : '#555566' }}>
            {localBri}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={isOn ? localBri : 0}
          disabled={!isOn}
          onChange={handleBrightnessChange}
          onMouseUp={handleBrightnessCommit}
          onTouchEnd={handleBrightnessCommit}
          className="w-full"
          style={{
            background: isOn
              ? `linear-gradient(to right, ${color} ${localBri}%, #2E2E3F ${localBri}%)`
              : '#2E2E3F',
            opacity: isOn ? 1 : 0.4,
          }}
        />
      </div>
    </div>
  )
}
