import React, { useState } from 'react';
import { Droplet, Upload, FileText } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import { pdfService } from '../services/PDFService';
import '../types';

const Watermark: React.FC = () => {
    const { dialog, notification, system } = useIntools('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
    const [text, setText] = useState('Confidential');
    const [options, setOptions] = useState({
        size: 50,
        opacity: 0.5,
        color: '#ff0000',
        rotate: 45
    });
    const [processing, setProcessing] = useState(false);

    const handleSelectFile = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 PDF 文件',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            properties: ['openFile']
        });

        if (result && result.length > 0) {
            setFile(result[0]);
        }
    };

    const handleApply = async () => {
        if (!file || !text) return;

        try {
            setProcessing(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';

            const outputPath = await window.pdfApi?.watermarkPDF(file, text, options, outputDir);

            if (outputPath) {
                notification.show('水印添加成功！', 'success');
                // shell.showItemInFolder(outputPath); // Prevent hiding window
            }
        } catch (error: any) {
            notification.show(`添加水印失败: ${error.message}`, 'error');
        } finally {
            setProcessing(false);
        }
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
                <Droplet color="var(--primary-color)" size={32} /> PDF 水印
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
                        <span style={{ fontWeight: '600', flex: 1 }}>{file.split(/[/\\]/).pop()}</span>
                        <button onClick={() => setFile(null)} style={{
                            border: 'none', background: 'rgba(0,0,0,0.05)', padding: '8px 16px', borderRadius: '12px',
                            cursor: 'pointer', color: 'var(--primary-color)', fontWeight: '500', fontSize: '14px'
                        }}>更换</button>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.6)', padding: '24px', borderRadius: '24px', marginBottom: '24px', border: '1px solid rgba(255,255,255,0.4)' }}>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', marginBottom: '10px', fontWeight: '600', color: 'var(--text-primary)' }}>水印文字</label>
                            <input
                                type="text"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                style={{
                                    width: '100%', padding: '12px 16px', borderRadius: '12px',
                                    border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.8)',
                                    fontSize: '16px', outline: 'none', transition: 'all 0.2s'
                                }}
                                onFocus={(e) => e.target.style.background = '#fff'}
                                onBlur={(e) => e.target.style.background = 'rgba(255,255,255,0.5)'}
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', color: 'var(--text-secondary)' }}>字号: {options.size}px</label>
                                <input
                                    type="range" min="10" max="200"
                                    value={options.size}
                                    onChange={(e) => setOptions({ ...options, size: parseInt(e.target.value) })}
                                    style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', color: 'var(--text-secondary)' }}>透明度: {options.opacity}</label>
                                <input
                                    type="range" min="0" max="1" step="0.1"
                                    value={options.opacity}
                                    onChange={(e) => setOptions({ ...options, opacity: parseFloat(e.target.value) })}
                                    style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', color: 'var(--text-secondary)' }}>旋转: {options.rotate}°</label>
                                <input
                                    type="range" min="0" max="360"
                                    value={options.rotate}
                                    onChange={(e) => setOptions({ ...options, rotate: parseInt(e.target.value) })}
                                    style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', color: 'var(--text-secondary)' }}>颜色</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <input
                                        type="color"
                                        value={options.color}
                                        onChange={(e) => setOptions({ ...options, color: e.target.value })}
                                        style={{
                                            width: '40px', height: '40px', border: 'none', padding: 0, borderRadius: '50%', overflow: 'hidden', cursor: 'pointer',
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                                        }}
                                    />
                                    <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{options.color}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ flex: 1 }}></div>

                    <button
                        onClick={handleApply}
                        disabled={processing || !text}
                        style={{
                            width: '100%',
                            padding: '18px',
                            border: 'none',
                            borderRadius: '16px',
                            background: processing || !text ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                            color: processing || !text ? 'var(--text-secondary)' : 'white',
                            fontSize: '17px',
                            fontWeight: '600',
                            cursor: processing || !text ? 'not-allowed' : 'pointer',
                            boxShadow: processing || !text ? 'none' : '0 10px 20px rgba(0, 122, 255, 0.3)',
                            transition: 'all 0.3s ease',
                            marginTop: 'auto',
                            letterSpacing: '-0.3px',
                            flexShrink: 0
                        }}
                        onMouseEnter={(e) => {
                            if (!processing && text) {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 14px 24px rgba(0, 122, 255, 0.4)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!processing && text) {
                                e.currentTarget.style.transform = 'none';
                                e.currentTarget.style.boxShadow = '0 10px 20px rgba(0, 122, 255, 0.3)';
                            }
                        }}
                    >
                        {processing ? '处理中...' : '添加水印'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default Watermark;
