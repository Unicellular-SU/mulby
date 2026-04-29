import { memo, useState } from 'react'
import type { PluginStorePlugin } from '../../shared/types/plugin-store'
import useCachedRemoteImage from '../hooks/useCachedRemoteImage'
import { getStorePluginInitial } from '../utils/plugin-store-helpers'

interface StorePluginIconProps {
  plugin: PluginStorePlugin
  size?: 'sm' | 'md' | 'lg'
}

const sizeConfig = {
  sm: { shell: 'h-8 w-8 rounded-lg', image: 'h-5 w-5 rounded-md', text: 'text-xs', emoji: 'text-sm' },
  md: { shell: 'h-10 w-10 rounded-xl', image: 'h-7 w-7 rounded-lg', text: 'text-sm', emoji: 'text-base' },
  lg: { shell: 'h-16 w-16 rounded-2xl', image: 'h-11 w-11 rounded-xl', text: 'text-xl', emoji: 'text-2xl' }
}

export default memo(function StorePluginIcon({ plugin, size = 'md' }: StorePluginIconProps) {
  const icon = plugin.icon
  const [iconFailed, setIconFailed] = useState(false)
  const cachedIconSrc = useCachedRemoteImage(icon?.type === 'url' ? icon.value : null)
  const cfg = sizeConfig[size]

  if (icon?.type === 'url' && !iconFailed && cachedIconSrc) {
    return (
      <div className={`flex shrink-0 items-center justify-center bg-slate-100 dark:bg-slate-800 ${cfg.shell}`}>
        <img
          src={cachedIconSrc}
          alt=""
          className={`${cfg.image} object-cover`}
          onError={() => setIconFailed(true)}
        />
      </div>
    )
  }

  if (icon?.type === 'emoji') {
    return (
      <div className={`flex shrink-0 items-center justify-center bg-slate-100 dark:bg-slate-800 ${cfg.shell} ${cfg.emoji}`}>
        {icon.value}
      </div>
    )
  }

  return (
    <div className={`flex shrink-0 items-center justify-center bg-slate-100 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200 ${cfg.shell} ${cfg.text}`}>
      {getStorePluginInitial(plugin)}
    </div>
  )
})
