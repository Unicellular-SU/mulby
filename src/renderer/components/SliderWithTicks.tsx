import { useId } from 'react'

interface SliderTick {
  value: number
  label?: string
}

interface SliderWithTicksProps {
  label?: string
  value: number
  min: number
  max: number
  step: number
  ticks: SliderTick[]
  disabled?: boolean
  snapToTicks?: boolean
  onChange: (value: number) => void
}

export default function SliderWithTicks({
  label,
  value,
  min,
  max,
  step,
  ticks,
  disabled,
  onChange,
  snapToTicks
}: SliderWithTicksProps) {
  const id = useId()
  const inputClass = 'w-full accent-slate-900 dark:accent-white'
  const tickValues = ticks.map((tick) => tick.value)
  const snapValue = (next: number) => {
    if (!snapToTicks || tickValues.length === 0) return next
    let closest = tickValues[0]
    let minDiff = Math.abs(next - closest)
    for (const value of tickValues) {
      const diff = Math.abs(next - value)
      if (diff < minDiff) {
        minDiff = diff
        closest = value
      }
    }
    return closest
  }

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label htmlFor={id} className="text-xs text-slate-600 dark:text-slate-300">
          {label}
        </label>
      ) : null}
      <input
        id={id}
        type="range"
        className={inputClass}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(snapValue(Number(event.target.value)))}
        onMouseUp={(event) => onChange(snapValue(Number((event.target as HTMLInputElement).value)))}
        onTouchEnd={(event) => onChange(snapValue(Number((event.target as HTMLInputElement).value)))}
      />
      <div className="flex justify-between text-[10px] text-slate-400">
        {ticks.map((tick) => (
          <span key={tick.value}>
            {tick.label ?? tick.value}
          </span>
        ))}
      </div>
    </div>
  )
}
