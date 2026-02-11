import React, { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Button, CodeBlock } from '../../components'
import { useMulby, useNotification } from '../../hooks'

interface Voice {
    name: string
    lang: string
    default: boolean
    localService: boolean
}

export function MediaModule() {
    const { tts, shell } = useMulby()
    const notify = useNotification()

    const [text, setText] = useState('你好，欢迎使用 Mulby 功能展示插件！这是一个语音合成测试。')
    const [voices, setVoices] = useState<Voice[]>([])
    const [selectedVoice, setSelectedVoice] = useState('')
    const [rate, setRate] = useState(1)
    const [pitch, setPitch] = useState(1)
    const [volume, setVolume] = useState(1)
    const [isSpeaking, setIsSpeaking] = useState(false)

    const loadVoices = useCallback(async () => {
        try {
            const voiceList = tts.getVoices()
            setVoices(voiceList || [])

            // 默认选择中文语音或第一个语音
            const zhVoice = voiceList?.find((v: Voice) => v.lang.startsWith('zh'))
            if (zhVoice) {
                setSelectedVoice(zhVoice.name)
            } else if (voiceList?.length > 0) {
                setSelectedVoice(voiceList[0].name)
            }
        } catch (error) {
            console.error('Failed to get voices:', error)
        }
    }, [tts])

    useEffect(() => {
        // 语音列表可能需要延迟加载
        loadVoices()
        const timer = setTimeout(loadVoices, 500)
        return () => clearTimeout(timer)
    }, [loadVoices])

    // 检查播放状态
    useEffect(() => {
        const checkSpeaking = () => {
            const speaking = tts.isSpeaking()
            setIsSpeaking(speaking || false)
        }

        const interval = setInterval(checkSpeaking, 200)
        return () => clearInterval(interval)
    }, [tts])

    const handleSpeak = useCallback(async () => {
        if (!text.trim()) {
            notify.warning('请输入要朗读的文本')
            return
        }

        try {
            const voice = voices.find(v => v.name === selectedVoice)
            await tts.speak(text, {
                lang: voice?.lang,
                rate,
                pitch,
                volume,
            })
            notify.info('开始朗读')
        } catch (error) {
            notify.error('朗读失败')
        }
    }, [text, selectedVoice, voices, rate, pitch, volume, tts, notify])

    const handleStop = useCallback(() => {
        tts.stop()
        notify.info('已停止')
    }, [tts, notify])

    const handlePause = useCallback(() => {
        tts.pause()
        notify.info('已暂停')
    }, [tts, notify])

    const handleResume = useCallback(() => {
        tts.resume()
        notify.info('继续朗读')
    }, [tts, notify])

    const handleBeep = useCallback(() => {
        shell.beep()
        notify.info('已播放提示音')
    }, [shell, notify])

    const sampleTexts = [
        { label: '中文', text: '你好，欢迎使用 Mulby 功能展示插件！' },
        { label: '英文', text: 'Hello, welcome to Mulby Showcase Plugin!' },
        { label: '数字', text: '今天是2024年1月1日，温度是25度。' },
        { label: '长文', text: 'Mulby 是一个强大的效率工具平台，支持插件扩展。用户可以通过简单的关键词或快捷键触发各种功能，大大提高工作效率。' },
    ]

    return (
        <div className="main-content">
            <PageHeader
                icon="🔊"
                title="媒体与音频"
                description="语音合成 (TTS) 和系统声音"
            />
            <div className="page-content">
                {/* TTS Controls */}
                <Card title="文字转语音 (TTS)" icon="🗣️">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div className="input-group">
                            <label className="input-label">朗读文本</label>
                            <textarea
                                className="textarea"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                placeholder="输入要朗读的文本..."
                                rows={4}
                            />
                        </div>

                        <div className="action-bar">
                            {sampleTexts.map((sample) => (
                                <Button
                                    key={sample.label}
                                    variant="secondary"
                                    onClick={() => setText(sample.text)}
                                >
                                    {sample.label}
                                </Button>
                            ))}
                        </div>

                        <div className="input-group">
                            <label className="input-label">语音 ({voices.length} 个可用)</label>
                            <select
                                className="select"
                                value={selectedVoice}
                                onChange={(e) => setSelectedVoice(e.target.value)}
                            >
                                {voices.map((voice) => (
                                    <option key={voice.name} value={voice.name}>
                                        {voice.name} ({voice.lang}) {voice.default ? '★' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-3">
                            <div className="input-group">
                                <label className="input-label">语速: {rate.toFixed(1)}x</label>
                                <div className="slider-group">
                                    <input
                                        type="range"
                                        className="slider"
                                        min="0.5"
                                        max="2"
                                        step="0.1"
                                        value={rate}
                                        onChange={(e) => setRate(parseFloat(e.target.value))}
                                    />
                                </div>
                            </div>

                            <div className="input-group">
                                <label className="input-label">音调: {pitch.toFixed(1)}</label>
                                <div className="slider-group">
                                    <input
                                        type="range"
                                        className="slider"
                                        min="0.5"
                                        max="2"
                                        step="0.1"
                                        value={pitch}
                                        onChange={(e) => setPitch(parseFloat(e.target.value))}
                                    />
                                </div>
                            </div>

                            <div className="input-group">
                                <label className="input-label">音量: {Math.round(volume * 100)}%</label>
                                <div className="slider-group">
                                    <input
                                        type="range"
                                        className="slider"
                                        min="0"
                                        max="1"
                                        step="0.1"
                                        value={volume}
                                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="action-bar">
                            <Button onClick={handleSpeak} disabled={isSpeaking}>
                                ▶️ 朗读
                            </Button>
                            <Button variant="secondary" onClick={handlePause} disabled={!isSpeaking}>
                                ⏸️ 暂停
                            </Button>
                            <Button variant="secondary" onClick={handleResume}>
                                ▶️ 继续
                            </Button>
                            <Button variant="secondary" onClick={handleStop}>
                                ⏹️ 停止
                            </Button>
                        </div>

                        {isSpeaking && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--spacing-sm)',
                                color: 'var(--accent)',
                            }}>
                                <span className="spinner" />
                                <span>正在朗读...</span>
                            </div>
                        )}
                    </div>
                </Card>

                {/* System Sound */}
                <Card title="系统声音" icon="🔔">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
                        <Button onClick={handleBeep}>🔔 播放系统提示音</Button>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                            调用 shell.beep() 播放系统默认提示音
                        </span>
                    </div>
                </Card>

                {/* Voice List */}
                <Card title="可用语音列表" icon="📋">
                    {voices.length > 0 ? (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                            gap: 'var(--spacing-sm)',
                            maxHeight: '300px',
                            overflowY: 'auto',
                        }}>
                            {voices.map((voice) => (
                                <div
                                    key={voice.name}
                                    onClick={() => setSelectedVoice(voice.name)}
                                    style={{
                                        padding: 'var(--spacing-sm)',
                                        background: selectedVoice === voice.name ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: 'pointer',
                                        transition: 'all var(--transition-fast)',
                                        border: selectedVoice === voice.name ? '1px solid var(--accent)' : '1px solid transparent',
                                    }}
                                >
                                    <div style={{ fontWeight: 500, fontSize: '12px' }}>{voice.name}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                        {voice.lang} {voice.default ? '• 默认' : ''}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-state">
                            <div>正在加载语音列表...</div>
                        </div>
                    )}
                </Card>

                {/* API Reference */}
                <Card title="使用的 API" icon="📖">
                    <CodeBlock>
                        {`// TTS 语音合成
await tts.speak('Hello World', {
  lang: 'en-US',
  rate: 1.2,    // 语速 0.1-10
  pitch: 1.0,   // 音调 0-2
  volume: 0.8   // 音量 0-1
})

tts.pause()    // 暂停
tts.resume()   // 继续
tts.stop()     // 停止

// 获取语音列表
const voices = tts.getVoices()
// [{ name, lang, default, localService }]

// 检查状态
const speaking = tts.isSpeaking()

// 系统声音
shell.beep()   // 播放提示音`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
