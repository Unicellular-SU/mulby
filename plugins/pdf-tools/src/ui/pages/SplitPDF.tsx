import React, { useState } from 'react';
import { Scissors, FileText, Plus, X, Upload } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import '../types';
import { PDFInfo, SplitRange } from '../types';

const SplitPDF: React.FC = () => {
    const { dialog, shell, notification, system } = useIntools('pdf-tools');
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

    return (
        <div style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Scissors color="var(--primary-color)" /> PDF 拆分
            </h2>

            {!file ? (
                <div
                    onClick={handleSelectFile}
                    style={{
                        background: 'rgba(255,255,255,0.4)',
                        borderRadius: 'var(--radius-md)',
                        padding: '40px',
                        textAlign: 'center',
                        border: '2px dashed var(--glass-border)',
                        cursor: 'pointer',
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center'
                    }}
                >
                    <Upload size={48} color="var(--primary-color)" style={{ marginBottom: '16px' }} />
                    <p>点击选择 PDF 文件</p>
                </div>
            ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{
                        background: 'rgba(255,255,255,0.5)',
                        padding: '16px',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <FileText size={24} color="var(--primary-color)" />
                        <div>
                            <div style={{ fontWeight: '600' }}>{file.split('/').pop()}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                {info?.pageCount} 页 | {info?.title || '无标题'}
                            </div>
                        </div>
                        <button onClick={() => { setFile(null); setInfo(null); }} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer' }}>更换</button>
                    </div>

                    <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
                        <button
                            onClick={() => setMode('auto')}
                            style={{
                                flex: 1,
                                padding: '10px',
                                border: mode === 'auto' ? '2px solid var(--primary-color)' : '1px solid var(--glass-border)',
                                borderRadius: 'var(--radius-sm)',
                                background: mode === 'auto' ? 'rgba(0,122,255,0.1)' : 'transparent',
                                cursor: 'pointer'
                            }}
                        >
                            自动拆分 (每页存为单独文件)
                        </button>
                        <button
                            onClick={() => setMode('manual')}
                            style={{
                                flex: 1,
                                padding: '10px',
                                border: mode === 'manual' ? '2px solid var(--primary-color)' : '1px solid var(--glass-border)',
                                borderRadius: 'var(--radius-sm)',
                                background: mode === 'manual' ? 'rgba(0,122,255,0.1)' : 'transparent',
                                cursor: 'pointer'
                            }}
                        >
                            手动拆分 (指定范围)
                        </button>
                    </div>

                    {mode === 'manual' && (
                        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px' }}>
                            {ranges.map((range, index) => (
                                <div key={index} style={{
                                    display: 'flex',
                                    gap: '10px',
                                    alignItems: 'center',
                                    marginBottom: '10px',
                                    background: 'rgba(255,255,255,0.3)',
                                    padding: '10px',
                                    borderRadius: '8px'
                                }}>
                                    <span>Part {index + 1}</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max={info?.pageCount}
                                        value={range.start}
                                        onChange={(e) => {
                                            const newRanges = [...ranges];
                                            newRanges[index].start = parseInt(e.target.value);
                                            setRanges(newRanges);
                                        }}
                                        style={{ width: '60px', padding: '4px', borderRadius: '4px', border: '1px solid #ddd' }}
                                    />
                                    <span>to</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max={info?.pageCount}
                                        value={range.end}
                                        onChange={(e) => {
                                            const newRanges = [...ranges];
                                            newRanges[index].end = parseInt(e.target.value);
                                            setRanges(newRanges);
                                        }}
                                        style={{ width: '60px', padding: '4px', borderRadius: '4px', border: '1px solid #ddd' }}
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
                                        style={{ flex: 1, padding: '4px', borderRadius: '4px', border: '1px solid #ddd' }}
                                    />
                                    <button onClick={() => {
                                        const newRanges = ranges.filter((_, i) => i !== index);
                                        setRanges(newRanges);
                                    }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'red' }}><X size={16} /></button>
                                </div>
                            ))}
                            <button onClick={addRange} style={{
                                display: 'flex', alignItems: 'center', gap: '5px',
                                border: 'none', background: 'transparent', color: 'var(--primary-color)', cursor: 'pointer', fontWeight: '500'
                            }}>
                                <Plus size={16} /> 添加范围
                            </button>
                        </div>
                    )}

                    <button
                        onClick={handleSplit}
                        disabled={splitting}
                        className="glass-panel"
                        style={{
                            width: '100%',
                            padding: '16px',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--primary-color)',
                            color: 'white',
                            fontSize: '16px',
                            fontWeight: '600',
                            marginTop: 'auto',
                            cursor: splitting ? 'not-allowed' : 'pointer',
                            opacity: splitting ? 0.7 : 1
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
