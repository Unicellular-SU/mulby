## 20. TTS API (tts)

TTS API 提供语音合成功能，使用 Web Speech API，支持 macOS、Windows 和 Linux。

### 20.1 speak(text, options?)
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

### 20.2 stop()
停止朗读。

```javascript
tts.stop();
```

### 20.3 pause() / resume()
暂停和恢复朗读。

```javascript
tts.pause();
tts.resume();
```

### 20.4 getVoices()
获取可用语音列表。

```javascript
const voices = tts.getVoices();
// [{ name: 'Samantha', lang: 'en-US', default: true, localService: true }, ...]
```

### 20.5 isSpeaking()
检查是否正在朗读。

```javascript
if (tts.isSpeaking()) {
  console.log('正在朗读中');
}
```
