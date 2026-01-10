export interface TTSOptions {
  text: string
  lang?: string
  rate?: number   // 0.1 - 10
  pitch?: number  // 0 - 2
  volume?: number // 0 - 1
}

export class PluginTTS {
  // TTS 主要在渲染进程中使用 Web Speech API
  // 这里提供一些辅助方法
}

export const pluginTTS = new PluginTTS()
