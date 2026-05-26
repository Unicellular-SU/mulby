import { useRef, useState } from 'react'
import { MULBY_ICON_ASSETS } from '../mulby-icon-assets'

export default function AboutIconGallery() {
  const [selectedId, setSelectedId] = useState(MULBY_ICON_ASSETS[0]?.id ?? 'v1')
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const selectedItem = MULBY_ICON_ASSETS.find((item) => item.id === selectedId) ?? MULBY_ICON_ASSETS[0]

  const scrollIcons = (direction: 'left' | 'right') => {
    const container = scrollerRef.current
    if (!container) {
      return
    }

    const offset = Math.max(container.clientWidth * 0.8, 180)
    container.scrollBy({
      left: direction === 'left' ? -offset : offset,
      behavior: 'smooth'
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-center rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-950/70">
        <img
          src={selectedItem.previewSrc}
          alt={selectedItem.title}
          className="h-24 w-24 object-contain sm:h-28 sm:w-28"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => scrollIcons('left')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-700"
          aria-label="向左滚动图标列表"
          title="向左滚动"
        >
          ‹
        </button>

        <div
          ref={scrollerRef}
          className="-mx-1 flex-1 overflow-x-auto pb-1"
        >
          <div className="flex min-w-max gap-3 px-1">
            {MULBY_ICON_ASSETS.map((item) => {
              const active = item.id === selectedItem.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border transition ${active
                    ? 'border-slate-900 bg-slate-900 dark:border-white dark:bg-white'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700'
                    }`}
                  aria-label={item.title}
                  aria-pressed={active}
                  title={item.title}
                >
                  <img
                    src={item.previewSrc}
                    alt=""
                    className="h-10 w-10 object-contain"
                  />
                </button>
              )
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => scrollIcons('right')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-700"
          aria-label="向右滚动图标列表"
          title="向右滚动"
        >
          ›
        </button>
      </div>
    </section>
  )
}
