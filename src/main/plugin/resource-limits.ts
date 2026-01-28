/**
 * Resource Limits Utility
 * Phase 4: 细粒度资源限制
 */

import type { ResourceLimits, ResourceLimitPreset } from '../../shared/types/plugin'
import type { WatchdogConfig } from './watchdog'

// 资源限制预设值
const RESOURCE_LIMIT_PRESETS: Record<ResourceLimitPreset, ResourceLimits> = {
  low: {
    maxMemoryMB: 128,
    maxRequestsPerMinute: 200,
    maxErrorsPerMinute: 10,
    memoryLeakThresholdMBPerMinute: 5
  },
  medium: {
    maxMemoryMB: 256,
    maxRequestsPerMinute: 500,
    maxErrorsPerMinute: 30,
    memoryLeakThresholdMBPerMinute: 10
  },
  high: {
    maxMemoryMB: 512,
    maxRequestsPerMinute: 1000,
    maxErrorsPerMinute: 50,
    memoryLeakThresholdMBPerMinute: 20
  },
  unlimited: {
    maxMemoryMB: 2048,
    maxRequestsPerMinute: 10000,
    maxErrorsPerMinute: 500,
    memoryLeakThresholdMBPerMinute: 50
  }
}

/**
 * 解析资源限制配置
 * @param config 插件配置的资源限制（可以是预设名称或自定义配置）
 * @param defaultPreset 默认预设（如果未指定配置）
 * @returns 解析后的资源限制配置
 */
export function resolveResourceLimits(
  config?: ResourceLimits | ResourceLimitPreset,
  defaultPreset: ResourceLimitPreset = 'medium'
): ResourceLimits {
  // 如果未指定配置，使用默认预设
  if (!config) {
    return RESOURCE_LIMIT_PRESETS[defaultPreset]
  }

  // 如果是字符串，作为预设名称处理
  if (typeof config === 'string') {
    return RESOURCE_LIMIT_PRESETS[config] || RESOURCE_LIMIT_PRESETS[defaultPreset]
  }

  // 如果是对象，合并默认预设和自定义配置
  const basePreset = RESOURCE_LIMIT_PRESETS[defaultPreset]
  return {
    maxMemoryMB: config.maxMemoryMB ?? basePreset.maxMemoryMB,
    maxRequestsPerMinute: config.maxRequestsPerMinute ?? basePreset.maxRequestsPerMinute,
    maxErrorsPerMinute: config.maxErrorsPerMinute ?? basePreset.maxErrorsPerMinute,
    memoryLeakThresholdMBPerMinute: config.memoryLeakThresholdMBPerMinute ?? basePreset.memoryLeakThresholdMBPerMinute
  }
}

/**
 * 将资源限制转换为 Watchdog 配置
 * @param limits 资源限制配置
 * @param baseConfig 基础 Watchdog 配置
 * @returns 合并后的 Watchdog 配置
 */
export function applyResourceLimitsToWatchdog(
  limits: ResourceLimits,
  baseConfig: WatchdogConfig
): WatchdogConfig {
  return {
    ...baseConfig,
    maxMemoryMB: limits.maxMemoryMB ?? baseConfig.maxMemoryMB,
    maxRequestsPerMinute: limits.maxRequestsPerMinute ?? baseConfig.maxRequestsPerMinute,
    maxErrorsPerMinute: limits.maxErrorsPerMinute ?? baseConfig.maxErrorsPerMinute,
    memoryLeakThresholdMBPerMinute: limits.memoryLeakThresholdMBPerMinute ?? baseConfig.memoryLeakThresholdMBPerMinute
  }
}
