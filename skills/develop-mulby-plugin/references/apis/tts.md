# TTS API (tts)
本文档描述 TTS API (tts) 的使用方法与接口。

> 入口：`window.mulby.tts`

TTS API 提供语音合成功能，使用 Web Speech API，支持 macOS、Windows 和 Linux。

### speak(text, options?)
[Renderer]
朗读文本。

```javascript
await tts.speak('你好，世界');

// 带选项
await tts.speak('Hello World', {
  lang: 'en-US',
  rate: 1.2,
  pitch: 1.0,
  volume: 0.8
});
```

**参数**:
- `text` (string) - 要朗读的文本
- `options` (可选):
  - `lang` (string) - 语言代码，如 'zh-CN', 'en-US'
  - `rate` (number) - 语速 0.1-10，默认 1
  - `pitch` (number) - 音调 0-2，默认 1
  - `volume` (number) - 音量 0-1，默认 1

### stop()
[Renderer]
停止朗读。

```javascript
tts.stop();
```

### pause() / resume()
[Renderer]
暂停和恢复朗读。

```javascript
tts.pause();
tts.resume();
```

### getVoices()
[Renderer]
获取可用语音列表。

```javascript
const voices = tts.getVoices();
// [{ name: 'Samantha', lang: 'en-US', default: true, localService: true }, ...]
```

### isSpeaking()
[Renderer]
检查是否正在朗读。

```javascript
if (tts.isSpeaking()) {
  console.log('正在朗读中');
}
```

### 完整示例

```javascript
await window.mulby.tts.speak('你好');
```