import React, { useState } from 'react';
import { Scissors, FileText, Plus, X, Upload } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import { pdfService } from '../services/PDFService';
import '../types';
import { PDFInfo, SplitRange } from '../types';

const SplitPDF: React.FC = () => {
    const { dialog, notification, system } = useIntools('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
    const [info, setInfo] = useState<PDFInfo | null>(null);
    const [mode, setMode] = useState<'auto' | 'manual'>('auto');
    const [ranges, setRanges] = useState<SplitRange[]>([]);
    const [splitting, setSplitting] = useState(false);

    const handleSelectFile = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 PDF 文件',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            properties: ['openFile']
        });

        if (result && result.length > 0) {
            const filePath = result[0];
            setFile(filePath);

            try {
                const info = await window.pdfApi?.getPDFInfo(filePath);
                setInfo(info || null);
                // Init default range
                setRanges([{ start: 1, end: info?.pageCount || 1, name: 'part_1' }]);
            } catch (error) {
                notification.show('读取PDF信息失败', 'error');
            }
        }
    };

    const handleSplit = async () => {
        if (!file) return;

        try {
            setSplitting(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';
            const filename = file.split('/').pop()?.replace('.pdf', '') || 'split';

            if (mode === 'auto') {
                await window.pdfApi?.splitPDFByPage(file, outputDir, filename);
            } else {
                await window.pdfApi?.splitPDFByRanges(file, ranges, outputDir);
            }

            notification.show('拆分成功！', 'success');
            // shell.openPath(outputDir); // Prevent hiding window
        } catch (error: any) {
            notification.show(`拆分失败: ${error.message}`, 'error');
        } finally {
            setSplitting(false);
        }
    };

    const addRange = () => {
        setRanges([...ranges, { start: 1, end: info?.pageCount || 1, name: `part_${ranges.length + 1}` }]);
    };

    const [preview, setPreview] = useState<string | null>(null);

    React.useEffect(() => {
        if (file) {
            pdfService.renderPageToDataURL(file, 1, 0.3).then(setPreview).catch(console.error);
        } else {
            setPreview(null);
        }
    }, [file]);

    return (
        <div style={{ padding: '10px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ marginBottom: '24px', fontSize: '28px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '12px', letterSpacing: '-0.5px' }}>
                <Scissors color="var(--primary-color)" size={32} /> PDF 拆分
            </h2>

            {!file ? (
                <div
                    onClick={handleSelectFile}
                    style={{
                        background: 'rgba(255,255,255,0.5)',
                        borderRadius: '20px',
                        padding: '40px',
                        textAlign: 'center',
                        border: '2px dashed rgba(0, 122, 255, 0.3)',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 122, 255, 0.05)';
                        e.currentTarget.style.borderColor = 'var(--primary-color)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.5)';
                        e.currentTarget.style.borderColor = 'rgba(0, 122, 255, 0.3)';
                    }}
                >
                    <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                        <div style={{ padding: '20px', background: 'var(--primary-color)', borderRadius: '50%', boxShadow: '0 8px 16px rgba(0, 122, 255, 0.2)' }}>
                            <Upload size={40} color="white" />
                        </div>
                    </div>
                    <p style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>点击选择 PDF 文件</p>
                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px' }}>支持拖拽上传</p>
                </div>
            ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{
                        background: 'rgba(255, 255, 255, 0.6)',
                        backdropFilter: 'blur(10px)',
                        padding: '20px',
                        borderRadius: '20px',
                        marginBottom: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '20px',
                        border: '1px solid rgba(255,255,255,0.4)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.03)'
                    }}>
                        <div style={{
                            width: '60px',
                            height: '80px',
                            background: '#fff',
                            borderRadius: '8px',
                            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            overflow: 'hidden',
                            flexShrink: 0
                        }}>
                            {preview ? (
                                <img src={preview} alt="Thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                                <FileText size={32} color="var(--primary-color)" />
                            )}
                        </div>

                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>{file.split(/[/\\]/).pop()}</div>
                            <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                                {info?.pageCount} 页 | {info?.title || '无标题'}
                            </div>
                        </div>
                        <button onClick={() => { setFile(null); setInfo(null); setRanges([]); }} style={{
                            border: 'none', background: 'rgba(0,0,0,0.05)', padding: '8px 16px', borderRadius: '12px',
                            cursor: 'pointer', color: 'var(--primary-color)', fontWeight: '500', fontSize: '14px'
                        }}>更换文件</button>
                    </div>

                    {/* Segmented Control */}
                    <div style={{
                        marginBottom: '24px',
                        display: 'flex',
                        padding: '4px',
                        background: 'rgba(118, 118, 128, 0.08)',
                        borderRadius: '12px'
                    }}>
                        <button
                            onClick={() => setMode('auto')}
                            style={{
                                flex: 1,
                                padding: '8px',
                                border: 'none',
                                borderRadius: '8px',
                                background: mode === 'auto' ? '#fff' : 'transparent',
                                color: mode === 'auto' ? '#000' : 'var(--text-secondary)',
                                fontWeight: mode === 'auto' ? '600' : '500',
                                boxShadow: mode === 'auto' ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            自动拆分
                        </button>
                        <button
                            onClick={() => setMode('manual')}
                            style={{
                                flex: 1,
                                padding: '8px',
                                border: 'none',
                                borderRadius: '8px',
                                background: mode === 'manual' ? '#fff' : 'transparent',
                                color: mode === 'manual' ? '#000' : 'var(--text-secondary)',
                                fontWeight: mode === 'manual' ? '600' : '500',
                                boxShadow: mode === 'manual' ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            手动拆分
                        </button>
                    </div>

                    {mode === 'manual' && (
                        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px' }}>
                            {ranges.map((range, index) => (
                                <div key={index} style={{
                                    display: 'flex',
                                    gap: '12px',
                                    alignItems: 'center',
                                    marginBottom: '10px',
                                    background: 'rgba(255,255,255,0.6)',
                                    padding: '12px',
                                    borderRadius: '16px',
                                    border: '1px solid rgba(255,255,255,0.4)'
                                }}>
                                    <span style={{ fontWeight: '600', width: '60px' }}>Part {index + 1}</span>
                                    <input
                                        type="number" min="1" max={info?.pageCount}
                                        value={range.start}
                                        onChange={(e) => {
                                            const newRanges = [...ranges];
                                            newRanges[index].start = parseInt(e.target.value);
                                            setRanges(newRanges);
                                        }}
                                        style={{ width: '60px', padding: '8px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.8)' }}
                                    />
                                    <span style={{ color: 'var(--text-secondary)' }}>to</span>
                                    <input
                                        type="number" min="1" max={info?.pageCount}
                                        value={range.end}
                                        onChange={(e) => {
                                            const newRanges = [...ranges];
                                            newRanges[index].end = parseInt(e.target.value);
                                            setRanges(newRanges);
                                        }}
                                        style={{ width: '60px', padding: '8px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.8)' }}
                                    />
                                    <input
                                        type="text"
                                        value={range.name}
                                        onChange={(e) => {
                                            const newRanges = [...ranges];
                                            newRanges[index].name = e.target.value;
                                            setRanges(newRanges);
                                        }}
                                        placeholder="文件名"
                                        style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.8)' }}
                                    />
                                    <button onClick={() => {
                                        const newRanges = ranges.filter((_, i) => i !== index);
                                        setRanges(newRanges);
                                    }} style={{ border: 'none', background: 'rgba(255,59,48,0.1)', width: '30px', height: '30px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', color: '#FF3B30' }}><X size={16} /></button>
                                </div>
                            ))}
                            <button onClick={addRange} style={{
                                display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '12px',
                                border: 'none', background: 'rgba(0,122,255,0.1)', color: 'var(--primary-color)', cursor: 'pointer', fontWeight: '600'
                            }}>
                                <Plus size={18} /> 添加拆分范围
                            </button>
                        </div>
                    )}

                    <div style={{ flex: 1 }}></div>

                    <button
                        onClick={handleSplit}
                        disabled={splitting}
                        style={{
                            width: '100%',
                            padding: '18px',
                            border: 'none',
                            borderRadius: '16px',
                            background: splitting ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                            color: splitting ? 'var(--text-secondary)' : 'white',
                            fontSize: '17px',
                            fontWeight: '600',
                            cursor: splitting ? 'not-allowed' : 'pointer',
                            boxShadow: splitting ? 'none' : '0 10px 20px rgba(0, 122, 255, 0.3)',
                            transition: 'all 0.3s ease',
                            marginTop: 'auto',
                            letterSpacing: '-0.3px',
                            flexShrink: 0
                        }}
                        onMouseEnter={(e) => {
                            if (!splitting) {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 14px 24px rgba(0, 122, 255, 0.4)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!splitting) {
                                e.currentTarget.style.transform = 'none';
                                e.currentTarget.style.boxShadow = '0 10px 20px rgba(0, 122, 255, 0.3)';
                            }
                        }}
                    >
                        {splitting ? '拆分中...' : '开始拆分'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default SplitPDF;
