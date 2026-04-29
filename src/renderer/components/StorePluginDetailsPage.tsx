import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluginStoreEntry } from '../../shared/types/plugin-store'
import useCachedRemoteImage from '../hooks/useCachedRemoteImage'
import {
  formatStorePackageTime,
  getStoreIntegrityMeta,
  getStorePluginDisplayName,
  getStoreStatusMeta,
  getStoreTransportMeta,
  STORE_BUTTON_EMPHASIS,
  STORE_BUTTON_PRIMARY,
  STORE_CARD_CLASS,
  STORE_SECTION_TITLE
} from '../utils/plugin-store-helpers'
import StorePageLayout from './StorePageLayout'
import StorePluginIcon from './StorePluginIcon'

interface StorePluginDetailsPageProps {
  entry: PluginStoreEntry
  installing: boolean
  onBack?: () => void
  onInstall: (entry: PluginStoreEntry) => void
}

interface StoreScreenshotPreview {
  url: string
  label: string
  index: number
}

function MetaItem({
  label,
  value,
  mono = false
}: {
  label: string
  value?: string | number | ReactNode
  mono?: boolean
}) {
  const displayValue =
    value === undefined || value === null || value === '' ? '—' : value
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      {typeof value === 'string' || typeof value === 'number' ? (
        <p
          className={`${mono ? 'font-mono text-sm' : 'text-sm'} break-words text-slate-900 dark:text-slate-100`}
        >
          {displayValue}
        </p>
      ) : (
        <div
          className={`${mono ? 'font-mono text-sm' : 'text-sm'} text-slate-900 dark:text-slate-100`}
        >
          {displayValue}
        </div>
      )}
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
  plugin: PluginStoreEntry['plugin']
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
      onClick={() => onPreview({ url, label, index })}
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

function ScreenshotPreviewModal({
  preview,
  totalCount,
  plugin,
  onClose,
  onNavigate
}: {
  preview: StoreScreenshotPreview
  totalCount: number
  plugin: PluginStoreEntry['plugin']
  onClose: () => void
  onNavigate: (delta: number) => void
}) {
  const [failed, setFailed] = useState(false)
  const cachedSrc = useCachedRemoteImage(preview.url)

  useEffect(() => {
    setFailed(false)
  }, [preview.url])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowLeft' && preview.index > 0) {
        event.preventDefault()
        onNavigate(-1)
      } else if (event.key === 'ArrowRight' && preview.index < totalCount - 1) {
        event.preventDefault()
        onNavigate(1)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [preview.index, totalCount, onClose, onNavigate])

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-transparent p-6 no-drag"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="截图预览"
    >
      <div
        className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white/92 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-950/82"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-4 dark:border-slate-800/80">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900 dark:text-white">
              {preview.label}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {preview.index + 1} / {totalCount} · 使用方向键切换，按 Esc 关闭
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalCount > 1 && (
              <>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  onClick={() => onNavigate(-1)}
                  disabled={preview.index === 0}
                  aria-label="上一张"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  onClick={() => onNavigate(1)}
                  disabled={preview.index === totalCount - 1}
                  aria-label="下一张"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            )}
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-5">
          {failed ? (
            <div className="flex h-full w-full items-center justify-center rounded-2xl border border-slate-200/70 bg-slate-50/90 dark:border-slate-800/80 dark:bg-slate-900/80">
              <StorePluginIcon plugin={plugin} size="lg" />
            </div>
          ) : (
            <img
              src={cachedSrc || preview.url}
              alt={preview.label}
              className="max-h-full max-w-full rounded-2xl object-contain"
              onError={() => setFailed(true)}
            />
          )}
        </div>
        {totalCount > 1 && (
          <div className="flex justify-center gap-1.5 border-t border-slate-200/70 px-5 py-3 dark:border-slate-800/80">
            {Array.from({ length: totalCount }).map((_, i) => (
              <button
                key={i}
                className={`h-1.5 rounded-full transition ${
                  i === preview.index
                    ? 'w-6 bg-slate-900 dark:bg-white'
                    : 'w-1.5 bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600'
                }`}
                onClick={() => onNavigate(i - preview.index)}
                aria-label={`截图 ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function StorePluginDetailsPage({
  entry,
  installing,
  onBack,
  onInstall
}: StorePluginDetailsPageProps) {
  const title = getStorePluginDisplayName(entry.plugin)
  const screenshots = entry.plugin.screenshots || []
  const [previewImage, setPreviewImage] = useState<StoreScreenshotPreview | null>(null)
  const details = entry.plugin.details?.trim() || entry.plugin.description
  const statusMeta = getStoreStatusMeta(entry.installState.status)
  const transportMeta = getStoreTransportMeta(entry.plugin.downloadUrl)
  const integrityMeta = getStoreIntegrityMeta(entry)
  const actionLabel =
    entry.installState.status === 'updatable'
      ? '更新插件'
      : entry.installState.status === 'installed'
        ? '已安装'
        : '安装插件'
  const actionDisabled =
    entry.installState.status === 'installed' || installing || !transportMeta.allowInstall
  const actionButtonClass =
    entry.installState.status === 'updatable' ? STORE_BUTTON_EMPHASIS : STORE_BUTTON_PRIMARY

  const handleNavigate = (delta: number) => {
    if (!previewImage) return
    const nextIndex = previewImage.index + delta
    if (nextIndex < 0 || nextIndex >= screenshots.length) return
    const shot = screenshots[nextIndex]
    setPreviewImage({
      url: shot.url,
      label: shot.caption || `${title} 截图 ${nextIndex + 1}`,
      index: nextIndex
    })
  }

  return (
    <StorePageLayout
      headerTitle="插件详情"
      onBack={onBack}
      headerActions={
        <button
          className={actionButtonClass}
          disabled={actionDisabled}
          onClick={() => onInstall(entry)}
        >
          {installing ? (
            <span className="flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
              </svg>
              处理中
            </span>
          ) : (
            actionLabel
          )}
        </button>
      }
    >
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-6">
        <div className={STORE_CARD_CLASS}>
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
                  {entry.plugin.type && (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                      {entry.plugin.type}
                    </span>
                  )}
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
                    <span
                      key={category}
                      className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700"
                    >
                      {category}
                    </span>
                  ))}
                  {entry.plugin.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800 dark:text-slate-300"
                    >
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
            <h4 className={STORE_SECTION_TITLE}>截图预览</h4>
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
          <h4 className={STORE_SECTION_TITLE}>插件详情</h4>
          <div className={STORE_CARD_CLASS}>
            <article className="prose prose-sm prose-slate max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{details}</ReactMarkdown>
            </article>
          </div>
        </div>

        <div className="mt-6">
          <h4 className={STORE_SECTION_TITLE}>元数据</h4>
          <div className={STORE_CARD_CLASS}>
            <div className="grid gap-4 sm:grid-cols-2">
              <MetaItem label="版本" value={entry.plugin.version} />
              <MetaItem label="作者" value={entry.plugin.author || '未知'} />
              <MetaItem
                label="主页"
                value={
                  entry.plugin.homepage ? (
                    <a
                      className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                      href={entry.plugin.homepage}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.plugin.homepage}
                    </a>
                  ) : (
                    '—'
                  )
                }
              />
              <MetaItem
                label="仓库"
                value={
                  entry.plugin.repository ? (
                    <a
                      className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                      href={entry.plugin.repository}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.plugin.repository}
                    </a>
                  ) : (
                    '—'
                  )
                }
              />
              <MetaItem label="下载地址" value={entry.plugin.downloadUrl} mono />
              <MetaItem label="SHA256" value={entry.plugin.sha256 || '未提供'} mono />
            </div>
          </div>
        </div>
      </div>

      {/* Sticky install bar at bottom */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-slate-200/70 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <StorePluginIcon plugin={entry.plugin} size="sm" />
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">{title}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">v{entry.plugin.version}</div>
            </div>
          </div>
          <button
            className={
              entry.installState.status === 'updatable'
                ? 'inline-flex h-9 min-w-[100px] items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-5 text-sm text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200'
                : 'inline-flex h-9 min-w-[100px] items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
            }
            disabled={actionDisabled}
            onClick={() => onInstall(entry)}
          >
            {installing ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
                </svg>
                处理中
              </span>
            ) : (
              actionLabel
            )}
          </button>
        </div>
      </div>

      {previewImage && (
        <ScreenshotPreviewModal
          preview={previewImage}
          totalCount={screenshots.length}
          plugin={entry.plugin}
          onClose={() => setPreviewImage(null)}
          onNavigate={handleNavigate}
        />
      )}
    </StorePageLayout>
  )
}
