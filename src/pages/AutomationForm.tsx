import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, AlertCircle, CheckCircle, Plus, Trash2 } from 'lucide-react'
import { useHue } from '../context/HueContext'
import {
  createAutomation,
  getAutomationHistory,
  getAutomations,
  updateAutomation,
} from '../api/automations'
import type {
  Action,
  AutomationRunLogEntry,
  Condition,
  SensorEvent,
  Trigger,
} from '../types/automation'

const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

const SENSOR_TYPE_LABELS: Record<string, string> = {
  ZLLPresence: 'présence',
  ZLLLightLevel: 'luminosité',
  ZLLSwitch: 'bouton',
  ZGPSwitch: 'bouton',
}

const SENSOR_EVENT_LABELS: Record<SensorEvent, string> = {
  motion: 'Mouvement détecté',
  no_motion: 'Plus de mouvement',
  button_press: 'Bouton pressé',
  low_light: 'Faible luminosité',
  bright_light: 'Forte luminosité',
}

// Les capteurs de présence/luminosité n'ont que 2 événements pertinents, les boutons un seul.
// Sans capteur sélectionné, on propose tout (l'utilisateur n'a pas encore choisi).
function sensorEventOptions(sensorType: string | undefined, allowButtonPress: boolean) {
  let allowed: SensorEvent[]
  if (sensorType === 'ZLLPresence') allowed = ['motion', 'no_motion']
  else if (sensorType === 'ZLLLightLevel') allowed = ['low_light', 'bright_light']
  else if (sensorType === 'ZLLSwitch' || sensorType === 'ZGPSwitch') allowed = ['button_press']
  else allowed = ['motion', 'no_motion', 'button_press', 'low_light', 'bright_light']
  if (!allowButtonPress) allowed = allowed.filter((event) => event !== 'button_press')
  return allowed.map((value) => ({ value, label: SENSOR_EVENT_LABELS[value] }))
}

function defaultTrigger(): Trigger {
  return { type: 'time', hour: 7, minute: 0, days: [] }
}

function defaultCondition(): Condition {
  return { type: 'time_window', after: { hour: 20, minute: 0 } }
}

function defaultAction(): Action {
  return { type: 'set_light_state', targetId: '', targetKind: 'light', update: { on: true } }
}

export default function AutomationForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { lights, groups, scenes, sensors } = useHue()
  const isEditing = Boolean(id)

  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [trigger, setTrigger] = useState<Trigger>(defaultTrigger())
  const [conditions, setConditions] = useState<Condition[]>([])
  const [actions, setActions] = useState<Action[]>([defaultAction()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<AutomationRunLogEntry[]>([])

  useEffect(() => {
    if (!id) return
    getAutomations().then((all) => {
      const existing = all.find((a) => a.id === id)
      if (!existing) return
      setName(existing.name)
      setEnabled(existing.enabled)
      setTrigger(existing.trigger)
      setConditions(existing.conditions)
      setActions(existing.actions)
    })
    getAutomationHistory(id).then(setHistory)
  }, [id])

  const handleSave = async () => {
    if (!name || actions.length === 0) {
      setError('Le nom et au moins une action sont requis.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = { name, enabled, trigger, conditions, actions }
      if (isEditing && id) {
        await updateAutomation(id, payload)
      } else {
        await createAutomation(payload)
      }
      navigate('/routines')
    } catch {
      setError("Impossible d'enregistrer l'automatisation.")
    } finally {
      setSaving(false)
    }
  }

  const toggleDay = (day: number) => {
    if (trigger.type !== 'time') return
    const days = trigger.days.includes(day)
      ? trigger.days.filter((d) => d !== day)
      : [...trigger.days, day]
    setTrigger({ ...trigger, days })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-7 pb-5 shrink-0">
        <button
          onClick={() => navigate('/routines')}
          className="flex items-center gap-2 text-text-secondary hover:text-white transition-colors mb-5 text-sm"
        >
          <ArrowLeft size={16} />
          Retour
        </button>
        <h1 className="text-2xl font-bold text-white">
          {isEditing ? "Modifier l'automatisation" : 'Nouvelle automatisation'}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-6 max-w-2xl">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-4">
          <label className="text-xs font-medium text-text-secondary">Nom</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Réveil progressif"
            className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
          />
        </section>

        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-4">
          <h2 className="font-semibold text-white">Déclencheur</h2>
          <select
            value={trigger.type}
            onChange={(e) => {
              const type = e.target.value as Trigger['type']
              if (type === 'time') setTrigger({ type: 'time', hour: 7, minute: 0, days: [] })
              else if (type === 'sun')
                setTrigger({ type: 'sun', event: 'sunset', offsetMinutes: 0 })
              else if (type === 'sensor')
                setTrigger({ type: 'sensor', sensorId: '', event: 'motion' })
              else
                setTrigger({ type: 'light_state', targetId: '', targetKind: 'light', state: 'on' })
            }}
            className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange"
          >
            <option value="time">Heure fixe</option>
            <option value="sun">Lever / coucher du soleil</option>
            <option value="sensor">Capteur Hue</option>
            <option value="light_state">État d'une lampe/groupe</option>
          </select>

          {trigger.type === 'time' && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={trigger.hour}
                  onChange={(e) => setTrigger({ ...trigger, hour: Number(e.target.value) })}
                  className="w-20 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                />
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={trigger.minute}
                  onChange={(e) => setTrigger({ ...trigger, minute: Number(e.target.value) })}
                  className="w-20 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                />
              </div>
              <div className="flex gap-2">
                {DAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`w-9 h-9 rounded-lg text-xs font-medium transition-all ${
                      trigger.days.includes(day)
                        ? 'bg-accent-orange text-white'
                        : 'bg-bg-primary text-text-secondary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted">Aucun jour sélectionné = tous les jours</p>
            </div>
          )}

          {trigger.type === 'sun' && (
            <div className="flex gap-3 items-center">
              <select
                value={trigger.event}
                onChange={(e) =>
                  setTrigger({ ...trigger, event: e.target.value as 'sunrise' | 'sunset' })
                }
                className="bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="sunrise">Lever du soleil</option>
                <option value="sunset">Coucher du soleil</option>
              </select>
              <input
                type="number"
                value={trigger.offsetMinutes}
                onChange={(e) => setTrigger({ ...trigger, offsetMinutes: Number(e.target.value) })}
                className="w-24 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
              />
              <span className="text-xs text-text-secondary">minutes (négatif = avant)</span>
            </div>
          )}

          {trigger.type === 'sensor' && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <select
                  value={trigger.sensorId}
                  onChange={(e) => {
                    const sensorId = e.target.value
                    const sensorType = sensors.find((s) => s.id === sensorId)?.type
                    const [defaultEvent] = sensorEventOptions(sensorType, true)
                    setTrigger({
                      ...trigger,
                      sensorId,
                      event: defaultEvent?.value ?? trigger.event,
                    })
                  }}
                  className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
                >
                  <option value="">Choisir un capteur...</option>
                  {sensors.map((sensor) => (
                    <option key={sensor.id} value={sensor.id}>
                      {sensor.name} ({SENSOR_TYPE_LABELS[sensor.type] ?? sensor.type})
                    </option>
                  ))}
                </select>
                <select
                  value={trigger.event}
                  onChange={(e) => setTrigger({ ...trigger, event: e.target.value as SensorEvent })}
                  className="bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
                >
                  {sensorEventOptions(
                    sensors.find((s) => s.id === trigger.sensorId)?.type,
                    true
                  ).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              {sensors.find((s) => s.id === trigger.sensorId)?.type === 'ZLLLightLevel' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary shrink-0">Seuil</span>
                  <input
                    type="number"
                    min={1}
                    value={trigger.threshold ?? ''}
                    onChange={(e) => {
                      const value = e.target.value
                      setTrigger({
                        ...trigger,
                        threshold: value === '' ? undefined : Number(value),
                      })
                    }}
                    placeholder="ex. 100"
                    className="w-24 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
                  />
                  <span className="text-xs text-text-secondary">
                    lux (vide = seuil par défaut du bridge)
                  </span>
                </div>
              )}
            </div>
          )}

          {trigger.type === 'light_state' && (
            <div className="flex gap-3">
              <select
                value={trigger.targetKind}
                onChange={(e) =>
                  setTrigger({ ...trigger, targetKind: e.target.value as 'light' | 'group' })
                }
                className="bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="light">Lampe</option>
                <option value="group">Groupe</option>
              </select>
              <select
                value={trigger.targetId}
                onChange={(e) => setTrigger({ ...trigger, targetId: e.target.value })}
                className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="">Choisir...</option>
                {(trigger.targetKind === 'light' ? lights : groups).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                value={trigger.state}
                onChange={(e) => setTrigger({ ...trigger, state: e.target.value as 'on' | 'off' })}
                className="bg-bg-primary border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="on">S'allume</option>
                <option value="off">S'éteint</option>
              </select>
            </div>
          )}
        </section>

        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Conditions (optionnel)</h2>
            <button
              type="button"
              onClick={() => setConditions([...conditions, defaultCondition()])}
              className="flex items-center gap-1 text-xs text-accent-orange hover:underline"
            >
              <Plus size={14} />
              Ajouter
            </button>
          </div>
          {conditions.map((condition, index) => (
            <div key={index} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <select
                  value={condition.type}
                  onChange={(e) => {
                    const type = e.target.value as Condition['type']
                    const next = [...conditions]
                    if (type === 'time_window')
                      next[index] = { type: 'time_window', after: { hour: 20, minute: 0 } }
                    else if (type === 'light_state')
                      next[index] = {
                        type: 'light_state',
                        targetId: '',
                        targetKind: 'light',
                        state: 'on',
                      }
                    else next[index] = { type: 'sensor_state', sensorId: '', state: 'motion' }
                    setConditions(next)
                  }}
                  className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                >
                  <option value="time_window">Fenêtre horaire</option>
                  <option value="light_state">État lampe/groupe</option>
                  <option value="sensor_state">État capteur</option>
                </select>

                {condition.type === 'time_window' && (
                  <>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={condition.after?.hour ?? 0}
                      onChange={(e) => {
                        const next = [...conditions]
                        next[index] = {
                          ...condition,
                          after: {
                            hour: Number(e.target.value),
                            minute: condition.after?.minute ?? 0,
                          },
                        }
                        setConditions(next)
                      }}
                      className="w-16 bg-bg-primary border border-white/10 rounded-xl px-2 py-2 text-white text-sm outline-none focus:border-accent-orange"
                    />
                    <span className="text-xs text-text-secondary">à</span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={condition.before?.hour ?? 23}
                      onChange={(e) => {
                        const next = [...conditions]
                        next[index] = {
                          ...condition,
                          before: {
                            hour: Number(e.target.value),
                            minute: condition.before?.minute ?? 59,
                          },
                        }
                        setConditions(next)
                      }}
                      className="w-16 bg-bg-primary border border-white/10 rounded-xl px-2 py-2 text-white text-sm outline-none focus:border-accent-orange"
                    />
                  </>
                )}

                {condition.type === 'light_state' && (
                  <>
                    <select
                      value={condition.targetKind}
                      onChange={(e) => {
                        const next = [...conditions]
                        next[index] = {
                          ...condition,
                          targetKind: e.target.value as 'light' | 'group',
                        }
                        setConditions(next)
                      }}
                      className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                    >
                      <option value="light">Lampe</option>
                      <option value="group">Groupe</option>
                    </select>
                    <select
                      value={condition.targetId}
                      onChange={(e) => {
                        const next = [...conditions]
                        next[index] = { ...condition, targetId: e.target.value }
                        setConditions(next)
                      }}
                      className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                    >
                      <option value="">Choisir...</option>
                      {(condition.targetKind === 'light' ? lights : groups).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={condition.state}
                      onChange={(e) => {
                        const next = [...conditions]
                        next[index] = { ...condition, state: e.target.value as 'on' | 'off' }
                        setConditions(next)
                      }}
                      className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                    >
                      <option value="on">Allumée</option>
                      <option value="off">Éteinte</option>
                    </select>
                  </>
                )}

                {condition.type === 'sensor_state' && (
                  <>
                    <select
                      value={condition.sensorId}
                      onChange={(e) => {
                        const sensorId = e.target.value
                        const sensorType = sensors.find((s) => s.id === sensorId)?.type
                        const [defaultEvent] = sensorEventOptions(sensorType, false)
                        const next = [...conditions]
                        next[index] = {
                          ...condition,
                          sensorId,
                          state: defaultEvent?.value ?? condition.state,
                        }
                        setConditions(next)
                      }}
                      className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                    >
                      <option value="">Choisir un capteur...</option>
                      {sensors
                        .filter((s) => s.type === 'ZLLPresence' || s.type === 'ZLLLightLevel')
                        .map((sensor) => (
                          <option key={sensor.id} value={sensor.id}>
                            {sensor.name} ({SENSOR_TYPE_LABELS[sensor.type] ?? sensor.type})
                          </option>
                        ))}
                    </select>
                    <select
                      value={condition.state}
                      onChange={(e) => {
                        const next = [...conditions]
                        next[index] = { ...condition, state: e.target.value as SensorEvent }
                        setConditions(next)
                      }}
                      className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                    >
                      {sensorEventOptions(
                        sensors.find((s) => s.id === condition.sensorId)?.type,
                        false
                      ).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setConditions(conditions.filter((_, i) => i !== index))}
                  className="text-text-secondary hover:text-red-400 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {condition.type === 'sensor_state' &&
                sensors.find((s) => s.id === condition.sensorId)?.type === 'ZLLLightLevel' && (
                  <div className="flex items-center gap-2 pl-1">
                    <span className="text-xs text-text-secondary shrink-0">Seuil</span>
                    <input
                      type="number"
                      min={1}
                      value={condition.threshold ?? ''}
                      onChange={(e) => {
                        const value = e.target.value
                        const next = [...conditions]
                        next[index] = {
                          ...condition,
                          threshold: value === '' ? undefined : Number(value),
                        }
                        setConditions(next)
                      }}
                      placeholder="ex. 100"
                      className="w-24 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
                    />
                    <span className="text-xs text-text-secondary">
                      lux (vide = seuil par défaut du bridge)
                    </span>
                  </div>
                )}
            </div>
          ))}
        </section>

        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Actions</h2>
            <button
              type="button"
              onClick={() => setActions([...actions, defaultAction()])}
              className="flex items-center gap-1 text-xs text-accent-orange hover:underline"
            >
              <Plus size={14} />
              Ajouter
            </button>
          </div>
          {actions.map((action, index) => (
            <div key={index} className="flex items-center gap-3">
              <select
                value={action.type}
                onChange={(e) => {
                  const type = e.target.value as Action['type']
                  const next = [...actions]
                  next[index] =
                    type === 'set_light_state'
                      ? {
                          type: 'set_light_state',
                          targetId: '',
                          targetKind: 'light',
                          update: { on: true },
                        }
                      : { type: 'activate_scene', groupId: '', sceneId: '' }
                  setActions(next)
                }}
                className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
              >
                <option value="set_light_state">Régler une lampe/groupe</option>
                <option value="activate_scene">Activer une scène</option>
              </select>

              {action.type === 'set_light_state' && (
                <>
                  <select
                    value={action.targetKind}
                    onChange={(e) => {
                      const next = [...actions]
                      next[index] = { ...action, targetKind: e.target.value as 'light' | 'group' }
                      setActions(next)
                    }}
                    className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="light">Lampe</option>
                    <option value="group">Groupe</option>
                  </select>
                  <select
                    value={action.targetId}
                    onChange={(e) => {
                      const next = [...actions]
                      next[index] = { ...action, targetId: e.target.value }
                      setActions(next)
                    }}
                    className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="">Choisir...</option>
                    {(action.targetKind === 'light' ? lights : groups).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={action.update.on === false ? 'off' : 'on'}
                    onChange={(e) => {
                      const next = [...actions]
                      next[index] = {
                        ...action,
                        update: { ...action.update, on: e.target.value === 'on' },
                      }
                      setActions(next)
                    }}
                    className="bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                  >
                    <option value="on">Allumer</option>
                    <option value="off">Éteindre</option>
                  </select>
                </>
              )}

              {action.type === 'activate_scene' && (
                <select
                  value={action.sceneId}
                  onChange={(e) => {
                    const scene = scenes.find((s) => s.id === e.target.value)
                    const next = [...actions]
                    next[index] = {
                      type: 'activate_scene',
                      groupId: scene?.group ?? '',
                      sceneId: e.target.value,
                    }
                    setActions(next)
                  }}
                  className="flex-1 bg-bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent-orange"
                >
                  <option value="">Choisir une scène...</option>
                  {scenes.map((scene) => (
                    <option key={scene.id} value={scene.id}>
                      {scene.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => setActions(actions.filter((_, i) => i !== index))}
                className="text-text-secondary hover:text-red-400 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </section>

        {isEditing && (
          <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-4">
            <h2 className="font-semibold text-white">Historique des exécutions</h2>
            {history.length === 0 ? (
              <p className="text-sm text-text-secondary">Aucune exécution pour l'instant.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {history.map((entry, index) => (
                  <li key={index} className="flex items-start gap-3">
                    {entry.success ? (
                      <CheckCircle size={16} className="text-accent-green shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex flex-col">
                      <span className="text-sm text-white">
                        {new Date(entry.at).toLocaleString('fr-FR')}
                      </span>
                      {entry.success ? (
                        <span className="text-xs text-text-secondary">
                          {entry.actionsExecuted} action{entry.actionsExecuted > 1 ? 's' : ''}{' '}
                          exécutée
                          {entry.actionsExecuted > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-red-400">
                          {entry.error ?? "Échec de l'exécution"}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="flex items-center gap-3 pb-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-accent-orange text-white text-sm font-semibold hover:bg-accent-orange-dark transition-all disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Activée
          </label>
        </div>
      </div>
    </div>
  )
}
