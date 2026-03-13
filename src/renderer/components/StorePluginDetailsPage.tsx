import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluginStoreEntry, PluginStorePlugin } from '../../shared/types/plugin-store'
import useCachedRemoteImage from '../hooks/useCachedRemoteImage'

interface StorePluginDetailsPageProps {
  entry: PluginStoreEntry
  installing: boolean
  onBack?: () => void
  onClose: () => void
  onInstall: (entry: PluginStoreEntry) => void
}

interface StoreScreenshotPreview {
  url: string
  label: string
}

function getStorePluginDisplayName(plugin: PluginStorePlugin): string {
  return plugin.displayName || plugin.name
}

function getStorePluginInitial(plugin: PluginStorePlugin): string {
  const text = getStorePluginDisplayName(plugin).trim()
  if (!text) return '?'
  return text.slice(0, 1).toUpperCase()
}

function formatStorePackageTime(timestamp?: string): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function getStoreTransportMeta(url: string): { label: string; allowInstall: boolean; className: string } {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') {
      return {
        label: 'HTTPS',
        allowInstall: true,
        className: 'border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
      }
    }
    const hostname = parsed.hostname.toLowerCase()
    if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
      return {
        label: 'Local HTTP',
        allowInstall: true,
        className: 'border-blue-200 text-blue-700 dark:border-blue-500/30 dark:text-blue-300'
      }
    }
    return {
      label: 'Need HTTPS',
      allowInstall: false,
      className: 'border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-300'
    }
  } catch {
    return {
      label: 'Invalid URL',
      allowInstall: false,
      className: 'border-red-200 text-red-700 dark:border-red-500/30 dark:text-red-300'
    }
  }
}

function getStoreIntegrityMeta(entry: PluginStoreEntry): { label: string; className: string } {
  if (entry.plugin.sha256) {
    return {
      label: 'SHA256',
      className: 'border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
    }
  }
  return {
    label: 'No checksum',
    className: 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'
  }
}

function getStoreStatusMeta(status: PluginStoreEntry['installState']['status']): { label: string; className: string } {
  switch (status) {
    case 'updatable':
      return {
        label: '可更新',
        className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
      }
    case 'installed':
      return {
        label: '已安装',
        className: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
      }
    default:
      return {
        label: '未安装',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
      }
  }
}

function MetaItem({ label, value, mono = false }: { label: string; value?: string | number | ReactNode; mono?: boolean }) {
  const displayValue = value === undefined || value === null || value === '' ? '—' : value
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</p>
      {typeof value === 'string' || typeof value === 'number' ? (
        <p className={`${mono ? 'font-mono text-sm' : 'text-sm'} break-words text-slate-900 dark:text-slate-100`}>
          {displayValue}
        </p>
      ) : (
        <div className={`${mono ? 'font-mono text-sm' : 'text-sm'} text-slate-900 dark:text-slate-100`}>
          {displayValue}
        </div>
      )}
    </div>
  )
}

function StorePluginIcon({ plugin, size = 'md' }: { plugin: PluginStorePlugin; size?: 'md' | 'lg' }) {
  const [iconFailed, setIconFailed] = useState(false)
  const icon = plugin.icon
  const cachedIconSrc = useCachedRemoteImage(icon?.type === 'url' ? icon.value : null)
  const shellClass = size === 'lg' ? 'h-16 w-16 rounded-2xl' : 'h-10 w-10 rounded-xl'
  const imageClass = size === 'lg' ? 'h-11 w-11 rounded-xl' : 'h-7 w-7 rounded-lg'
  const textClass = size === 'lg' ? 'text-xl' : 'text-sm'

  if (icon?.type === 'url' && !iconFailed && cachedIconSrc) {
    return (
      <div className={`flex shrink-0 items-center justify-center bg-slate-100 dark:bg-slate-800 ${shellClass}`}>
        <img src={cachedIconSrc} alt="" className={`${imageClass} object-cover`} onError={() => setIconFailed(true)} />
      </div>
    )
  }

  if (icon?.type === 'emoji') {
    return (
      <div className={`flex shrink-0 items-center justify-center bg-slate-100 dark:bg-slate-800 ${shellClass} ${size === 'lg' ? 'text-2xl' : 'text-base'}`}>
        {icon.value}
      </div>
    )
  }

  return (
    <div className={`flex shrink-0 items-center justify-center bg-slate-100 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200 ${shellClass} ${textClass}`}>
      {getStorePluginInitial(plugin)}
    </div>
  )
}

function StorePluginScreenshot({
  plugin,
  url,
  caption,
  index,
  onPreview
}: {
  plugin: PluginStorePlugin
  url: string
  caption?: string
  index: number
  onPreview: (preview: StoreScreenshotPreview) => void
}) {
  const [failed, setFailed] = useState(false)
  const title = getStorePluginDisplayName(plugin)
  const label = caption || `${title} 截图 ${index + 1}`
  const cachedScreenshotSrc = useCachedRemoteImage(url)

  if (failed) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/80 dark:border-slate-800/80 dark:bg-slate-950/60">
        <div className="flex aspect-[16/10] items-center justify-center">
          <StorePluginIcon plugin={plugin} size="lg" />
        </div>
        <div className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{label}</div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="group overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/80 text-left transition hover:border-slate-300 dark:border-slate-800/80 dark:bg-slate-950/60 dark:hover:border-slate-700"
      onClick={() => onPreview({ url, label })}
    >
      <div className="aspect-[16/10] overflow-hidden">
        <img
          src={cachedScreenshotSrc || url}
          alt={label}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          onError={() => setFailed(true)}
        />
      </div>
      <div className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{label}</div>
    </button>
  )
}

export default function StorePluginDetailsPage({
  entry,
  installing,
  onBack,
  onClose,
  onInstall
}: StorePluginDetailsPageProps) {
  const title = getStorePluginDisplayName(entry.plugin)
  const screenshots = entry.plugin.screenshots || []
  const [previewImage, setPreviewImage] = useState<StoreScreenshotPreview | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const previewImageSrc = useCachedRemoteImage(previewImage?.url)
  const details = entry.plugin.details?.trim() || entry.plugin.description
  const statusMeta = getStoreStatusMeta(entry.installState.status)
  const transportMeta = getStoreTransportMeta(entry.plugin.downloadUrl)
  const integrityMeta = getStoreIntegrityMeta(entry)
  const actionLabel = entry.installState.status === 'updatable'
    ? '更新插件'
    : entry.installState.status === 'installed'
      ? '已安装'
      : '安装插件'
  const actionDisabled = entry.installState.status === 'installed' || installing || !transportMeta.allowInstall
  const topGhostButtonClass = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 text-xs leading-none text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 no-drag'
  const topPrimaryButtonClass = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 text-xs leading-none text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 no-drag'
  const topEmphasisButtonClass = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-900 bg-slate-900 px-3 text-xs leading-none text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 no-drag'
  const cardClass = 'rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900'
  const sectionTitleClass = 'mb-3 text-sm font-semibold text-slate-900 dark:text-white'
  const actionButtonClass = entry.installState.status === 'updatable'
    ? topEmphasisButtonClass
    : topPrimaryButtonClass

  useEffect(() => {
    setPreviewFailed(false)
  }, [previewImage])

  useEffect(() => {
    if (!previewImage) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPreviewImage(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [previewImage])

  return (
    <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-500/20" />
        <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-[120px] dark:bg-emerald-400/10" />
        <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-indigo-200/30 blur-[120px] dark:bg-indigo-500/10" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
          {onBack && (
            <button
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
              title="返回"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <div className="flex-1">
            <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Store</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">插件详情</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={actionButtonClass}
              disabled={actionDisabled}
              onClick={() => onInstall(entry)}
            >
              {installing ? '处理中...' : actionLabel}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-drag">
          <div className="mx-auto max-w-6xl px-6 pb-8 pt-6">
            <div className={cardClass}>
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start">
                  <StorePluginIcon plugin={entry.plugin} size="lg" />
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        v{entry.plugin.version}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${statusMeta.className}`}>
                        {statusMeta.label}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${transportMeta.className}`}>
                        下载: {transportMeta.label}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${integrityMeta.className}`}>
                        校验: {integrityMeta.label}
                      </span>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {entry.plugin.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      {entry.plugin.author && (
                        <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                          作者: {entry.plugin.author}
                        </span>
                      )}
                      {entry.plugin.license && (
                        <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                          {entry.plugin.license}
                        </span>
                      )}
                      <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                        来源: {entry.sourceName}
                      </span>
                      {entry.installState.installedVersion && (
                        <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                          本地 v{entry.installState.installedVersion}
                        </span>
                      )}
                      {entry.plugin.categories?.map((category) => (
                        <span key={category} className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                          {category}
                        </span>
                      ))}
                      {entry.plugin.tags?.map((tag) => (
                        <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800 dark:text-slate-300">
                          #{tag}
                        </span>
                      ))}
                      {entry.plugin.homepage && (
                        <a
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-white"
                          href={entry.plugin.homepage}
                          target="_blank"
                          rel="noreferrer"
                        >
                          官方主页
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <MetaItem label="唯一标识" value={entry.plugin.id} mono />
                  <MetaItem label="发布时间" value={formatStorePackageTime(entry.plugin.lastPackageTime)} />
                  <MetaItem label="仓库源" value={entry.sourceName} />
                  <MetaItem label="本地版本" value={entry.installState.installedVersion || '未安装'} />
                </div>
              </div>
            </div>

            {screenshots.length > 0 && (
              <div className="mt-6">
                <h4 className={sectionTitleClass}>截图预览</h4>
                <div className="grid gap-4 md:grid-cols-2">
                  {screenshots.map((shot, index) => (
                    <StorePluginScreenshot
                      key={`${shot.url}-${index}`}
                      plugin={entry.plugin}
                      url={shot.url}
                      caption={shot.caption}
                      index={index}
                      onPreview={setPreviewImage}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              <h4 className={sectionTitleClass}>插件详情</h4>
              <div className={cardClass}>
                <article className="prose prose-sm prose-slate max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {details}
                  </ReactMarkdown>
                </article>
              </div>
            </div>

            <div className="mt-6">
              <h4 className={sectionTitleClass}>元数据</h4>
              <div className={cardClass}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <MetaItem label="版本" value={entry.plugin.version} />
                  <MetaItem label="作者" value={entry.plugin.author || '未知'} />
                  <MetaItem
                    label="主页"
                    value={entry.plugin.homepage ? (
                      <a className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-200" href={entry.plugin.homepage} target="_blank" rel="noreferrer">
                        {entry.plugin.homepage}
                      </a>
                    ) : '—'}
                  />
                  <MetaItem
                    label="仓库"
                    value={entry.plugin.repository ? (
                      <a className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-200" href={entry.plugin.repository} target="_blank" rel="noreferrer">
                        {entry.plugin.repository}
                      </a>
                    ) : '—'}
                  />
                  <MetaItem label="下载地址" value={entry.plugin.downloadUrl} mono />
                  <MetaItem label="SHA256" value={entry.plugin.sha256 || '未提供'} mono />
                </div>
              </div>
            </div>
          </div>
        </div>

        {previewImage && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-transparent p-6 no-drag"
            onClick={() => setPreviewImage(null)}
          >
            <div
              className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white/92 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-950/82"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-4 dark:border-slate-800/80">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">{previewImage.label}</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">点击遮罩或按 Esc 关闭预览</div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600"
                  onClick={() => setPreviewImage(null)}
                >
                  关闭
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center p-5">
                {previewFailed ? (
                  <div className="flex h-full w-full items-center justify-center rounded-2xl border border-slate-200/70 bg-slate-50/90 dark:border-slate-800/80 dark:bg-slate-900/80">
                    <StorePluginIcon plugin={entry.plugin} size="lg" />
                  </div>
                ) : (
                  <img
                    src={previewImageSrc || previewImage.url}
                    alt={previewImage.label}
                    className="max-h-full max-w-full rounded-2xl object-contain"
                    onError={() => setPreviewFailed(true)}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
