import React, { useState, useEffect, useRef } from 'react';
import { Scissors, Plus, Trash2, Upload, ArrowRight, LayoutGrid, List } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import { pdfService } from '../services/PDFService';
import '../types';
import { PDFInfo, SplitRange } from '../types';

const PDFPageThumbnail: React.FC<{
    pdfDoc: any; // Using any to avoid complex type setup in this file, ideally PDFDocumentProxy
    pageNum: number;
    scale?: number;
}> = ({ pdfDoc, pageNum, scale = 0.2 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const renderPage = async () => {
            if (!pdfDoc || !canvasRef.current) return;
            try {
                const page = await pdfDoc.getPage(pageNum);
                if (!mounted) return;

                const viewport = page.getViewport({ scale });
                const canvas = canvasRef.current;
                const context = canvas.getContext('2d');

                if (context) {
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;

                    await page.render({
                        canvasContext: context,
                        viewport: viewport
                    }).promise;
                }
                setLoading(false);
            } catch (err) {
                console.error(`Error rendering page ${pageNum}:`, err);
            }
        };
        renderPage();
        return () => { mounted = false; };
    }, [pdfDoc, pageNum, scale]);

    return (
        <div style={{
            position: 'relative',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            background: '#fff',
            aspectRatio: '1/1.414',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            <div style={{
                position: 'absolute',
                bottom: '4px',
                right: '4px',
                background: 'rgba(0,0,0,0.5)',
                color: 'white',
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px'
            }}>
                {pageNum}
            </div>
            {loading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f7' }}>
                    <div style={{ width: '16px', height: '16px', border: '2px solid rgba(0,0,0,0.1)', borderTopColor: 'var(--primary-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                </div>
            )}
        </div>
    );
};

const SplitPDF: React.FC = () => {
    const { dialog, notification, system } = useIntools('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
    const [info, setInfo] = useState<PDFInfo | null>(null);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
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
                // Get info
                const info = await window.pdfApi?.getPDFInfo(filePath);
                setInfo(info || null);
                setRanges([{ start: 1, end: info?.pageCount || 1, name: 'part_1' }]);

                // Load doc for preview
                const doc = await pdfService.getDocument(filePath);
                setPdfDoc(doc);
            } catch (error) {
                console.error(error);
                notification.show('读取PDF失败', 'error');
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

            notification.show('拆分成功！文件已保存到下载目录', 'success');
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
        <div style={{ padding: '10px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: file ? '16px' : '24px' }}>
                <h2 style={{ fontSize: '28px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '12px', letterSpacing: '-0.5px', margin: 0 }}>
                    <Scissors color="var(--primary-color)" size={32} /> PDF 拆分
                </h2>

                {file && (
                    <button onClick={handleSelectFile} style={{
                        display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '12px',
                        border: '1px dashed rgba(0, 122, 255, 0.5)', background: 'rgba(0, 122, 255, 0.05)', color: 'var(--primary-color)',
                        cursor: 'pointer', fontSize: '14px', fontWeight: '500', transition: 'all 0.2s ease', height: 'fit-content'
                    }}>
                        更换文件
                    </button>
                )}
            </div>

            {!file ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div
                        onClick={handleSelectFile}
                        style={{
                            background: 'rgba(255,255,255,0.5)',
                            borderRadius: '24px',
                            padding: '60px 40px',
                            textAlign: 'center',
                            border: '2px dashed rgba(0, 122, 255, 0.3)',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '16px'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(0, 122, 255, 0.05)';
                            e.currentTarget.style.borderColor = 'var(--primary-color)';
                            e.currentTarget.style.transform = 'scale(1.01)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
                            e.currentTarget.style.borderColor = 'rgba(0, 122, 255, 0.3)';
                            e.currentTarget.style.transform = 'scale(1)';
                        }}
                    >
                        <div style={{
                            width: '96px', height: '96px', background: 'var(--primary-color)',
                            borderRadius: '50%', boxShadow: '0 12px 24px rgba(0, 122, 255, 0.25)',
                            marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <Upload size={48} color="white" />
                        </div>
                        <div>
                            <p style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '8px' }}>点击选择 PDF 文件</p>
                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>支持拖拽上传</p>
                        </div>
                    </div>
                </div>
            ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                    {/* Mode Toggle */}
                    <div style={{ marginBottom: '16px' }}>
                        <div style={{
                            display: 'flex', padding: '4px', background: 'rgba(118, 118, 128, 0.12)', borderRadius: '12px'
                        }}>
                            {(['auto', 'manual'] as const).map(m => (
                                <button
                                    key={m}
                                    onClick={() => setMode(m)}
                                    style={{
                                        flex: 1,
                                        padding: '8px',
                                        border: 'none',
                                        borderRadius: '8px',
                                        background: mode === m ? '#fff' : 'transparent',
                                        color: mode === m ? '#000' : 'var(--text-secondary)',
                                        fontWeight: mode === m ? '600' : '500',
                                        boxShadow: mode === m ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px'
                                    }}
                                >
                                    {m === 'auto' ? <LayoutGrid size={16} /> : <List size={16} />}
                                    {m === 'auto' ? '自动拆分 (每页存为单独文件)' : '自定义拆分 (指定页面范围)'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Manual Range Editor */}
                    {mode === 'manual' && (
                        <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '16px', padding: '4px' }}>
                            {ranges.map((range, index) => (
                                <div key={index} style={{
                                    display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px',
                                    background: 'rgba(255,255,255,0.6)', padding: '8px 12px', borderRadius: '12px',
                                    border: '1px solid rgba(255,255,255,0.4)'
                                }}>
                                    <span style={{ fontWeight: '600', fontSize: '13px', width: '64px', whiteSpace: 'nowrap', flexShrink: 0 }}>第 {index + 1} 部分</span>
                                    <input
                                        type="number" min="1" max={info?.pageCount} value={range.start}
                                        onChange={(e) => { const n = [...ranges]; n[index].start = parseInt(e.target.value); setRanges(n); }}
                                        style={{ width: '50px', padding: '6px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)' }}
                                    />
                                    <ArrowRight size={14} color="var(--text-secondary)" />
                                    <input
                                        type="number" min="1" max={info?.pageCount} value={range.end}
                                        onChange={(e) => { const n = [...ranges]; n[index].end = parseInt(e.target.value); setRanges(n); }}
                                        style={{ width: '50px', padding: '6px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)' }}
                                    />
                                    <input
                                        type="text" value={range.name} placeholder="文件名"
                                        onChange={(e) => { const n = [...ranges]; n[index].name = e.target.value; setRanges(n); }}
                                        style={{ flex: 1, padding: '6px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)' }}
                                    />
                                    <button onClick={() => setRanges(ranges.filter((_, i) => i !== index))} style={{
                                        border: 'none', background: 'rgba(255,59,48,0.1)', width: '28px', height: '28px', minWidth: '28px', borderRadius: '50%',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, padding: 0
                                    }}><Trash2 size={14} color="#FF3B30" /></button>
                                </div>
                            ))}
                            <button onClick={addRange} style={{
                                width: '100%', padding: '8px', borderRadius: '10px', border: '1px dashed var(--primary-color)',
                                background: 'rgba(0,122,255,0.05)', color: 'var(--primary-color)', cursor: 'pointer', fontSize: '13px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                            }}>
                                <Plus size={16} /> 添加范围
                            </button>
                        </div>
                    )}

                    {/* PDF Page Grid */}
                    <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px', background: 'rgba(0,0,0,0.02)', borderRadius: '16px', padding: '16px' }}>
                        {pdfDoc && info ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '16px' }}>
                                {Array.from({ length: info.pageCount }).map((_, i) => (
                                    <PDFPageThumbnail key={i} pdfDoc={pdfDoc} pageNum={i + 1} />
                                ))}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                                正在加载预览...
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleSplit}
                        disabled={splitting}
                        style={{
                            width: '100%',
                            padding: '16px',
                            border: 'none',
                            borderRadius: '16px',
                            background: splitting ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                            color: splitting ? 'var(--text-secondary)' : 'white',
                            fontSize: '17px',
                            fontWeight: '600',
                            cursor: splitting ? 'not-allowed' : 'pointer',
                            boxShadow: splitting ? 'none' : '0 10px 20px rgba(0, 122, 255, 0.3)',
                            transition: 'all 0.3s ease',
                            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px'
                        }}
                    >
                        {splitting ? '拆分中...' : <><Scissors size={20} /> 开始拆分</>}
                    </button>
                </div>
            )}
        </div>
    );
};

export default SplitPDF;
