import { useRef, useState } from 'react'

interface GalleryItem {
  id: string
  title: string
  previewSrc: string
}

const GALLERY_ITEMS: GalleryItem[] = [
  { id: 'v1', title: 'Mulby V1', previewSrc: new URL('../../../../../resources/tray/mulby-v1.svg', import.meta.url).href },
  { id: 'v2', title: 'Mulby V2', previewSrc: new URL('../../../../../resources/tray/mulby-v2.svg', import.meta.url).href },
  { id: 'v3', title: 'Mulby V3', previewSrc: new URL('../../../../../resources/tray/mulby-v3.svg', import.meta.url).href },
  { id: 'v4', title: 'Mulby V4', previewSrc: new URL('../../../../../resources/tray/mulby-v4.svg', import.meta.url).href },
  { id: 'v5', title: 'Mulby V5', previewSrc: new URL('../../../../../resources/tray/mulby-v5.svg', import.meta.url).href },
  { id: 'v6', title: 'Mulby V6', previewSrc: new URL('../../../../../resources/tray/mulby-v6.svg', import.meta.url).href },
  { id: 'v7', title: 'Mulby V7', previewSrc: new URL('../../../../../resources/tray/mulby-v7.svg', import.meta.url).href },
  { id: 'v8', title: 'Mulby V8', previewSrc: new URL('../../../../../resources/tray/mulby-v8.svg', import.meta.url).href },
  { id: 'v9', title: 'Mulby V9', previewSrc: new URL('../../../../../resources/tray/mulby-v9.svg', import.meta.url).href },
  { id: 'v10', title: 'Mulby V10', previewSrc: new URL('../../../../../resources/tray/mulby-v10.svg', import.meta.url).href }
]

export default function AboutIconGallery() {
  const [selectedId, setSelectedId] = useState(GALLERY_ITEMS[0]?.id ?? 'v1')
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const selectedItem = GALLERY_ITEMS.find((item) => item.id === selectedId) ?? GALLERY_ITEMS[0]

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
            {GALLERY_ITEMS.map((item) => {
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
