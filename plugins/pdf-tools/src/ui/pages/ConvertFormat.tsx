import React, { useState } from 'react';
import { FileText, Presentation, Sheet, FileQuestion, Upload } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import { pdfService } from '../services/PDFService';
import '../types';

interface ConvertFormatProps {
    type: 'word' | 'ppt' | 'excel';
}

const ConvertFormat: React.FC<ConvertFormatProps> = ({ type }) => {
    const { dialog, shell, notification, system } = useIntools('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);

    const titles = {
        word: 'PDF 转 Word',
        ppt: 'PDF 转 PPT',
        excel: 'PDF 转 Excel'
    };

    const getIcon = () => {
        switch (type) {
            case 'word': return <FileText size={24} color="var(--primary-color)" />;
            case 'ppt': return <Presentation size={24} color="var(--primary-color)" />;
            case 'excel': return <Sheet size={24} color="var(--primary-color)" />;
            default: return <FileQuestion size={24} color="var(--primary-color)" />;
        }
    };

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

    const handleConvert = async () => {
        if (!file) return;

        try {
            setProcessing(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';

            let outputPath;
            switch (type) {
                case 'word':
                    outputPath = await pdfService.convertToWord(file, outputDir);
                    break;
                case 'ppt':
                    outputPath = await pdfService.convertToPPT(file, outputDir);
                    break;
                case 'excel':
                    outputPath = await pdfService.convertToExcel(file, outputDir);
                    break;
            }

            if (outputPath) {
                notification.show('转换成功！', 'success');
                shell.showItemInFolder(outputPath);
            }
        } catch (error: any) {
            notification.show(`转换失败: ${error.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    const [previews, setPreviews] = useState<string[]>([]);
    const [pageCount, setPageCount] = useState(0);

    React.useEffect(() => {
        if (!file) {
            setPreviews([]);
            setPageCount(0);
            return;
        }

        const loadPreviews = async () => {
            try {
                const count = await pdfService.getPageCount(file);
                setPageCount(count);

                // Load first 10 pages for preview
                const numToLoad = Math.min(count, 10);
                const loadedPreviews = [];
                for (let i = 1; i <= numToLoad; i++) {
                    const dataUrl = await pdfService.renderPageToDataURL(file, i, 0.3);
                    loadedPreviews.push(dataUrl);
                }
                setPreviews(loadedPreviews);
            } catch (error) {
                console.error('Failed to load previews:', error);
            }
        };

        loadPreviews();
    }, [file]);

    return (
        <div style={{ padding: '10px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ marginBottom: '24px', fontSize: '28px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '12px', letterSpacing: '-0.5px' }}>
                {React.cloneElement(getIcon() as React.ReactElement, { size: 32 })} {titles[type]}
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
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
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
                        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                        flexShrink: 0
                    }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            background: '#fff',
                            borderRadius: '12px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            color: 'var(--primary-color)'
                        }}>
                            <FileText size={28} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '16px', fontWeight: '600' }}>{file.split(/[/\\]/).pop()}</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{pageCount} 页</div>
                        </div>
                        <button onClick={() => setFile(null)} style={{
                            border: 'none', background: 'rgba(0,0,0,0.05)', padding: '8px 16px', borderRadius: '12px',
                            cursor: 'pointer', color: 'var(--primary-color)', fontWeight: '500', fontSize: '14px'
                        }}>更换</button>
                    </div>

                    {/* Preview Grid */}
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        marginBottom: '20px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                        gap: '16px',
                        padding: '4px'
                    }}>
                        {previews.map((src, index) => (
                            <div key={index} style={{
                                background: 'white',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                aspectRatio: '0.7',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                border: '1px solid rgba(0,0,0,0.05)',
                                transition: 'transform 0.2s',
                                cursor: 'default'
                            }}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none' }}
                            >
                                <img src={src} alt={`Page ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            </div>
                        ))}
                        {pageCount > previews.length && (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                color: 'var(--text-secondary)',
                                fontSize: '13px',
                                background: 'rgba(0,0,0,0.03)',
                                borderRadius: '12px'
                            }}>
                                +{pageCount - previews.length} 更多...
                            </div>
                        )}
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.5)', padding: '20px', borderRadius: '20px', marginBottom: '20px', flexShrink: 0 }}>
                        <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', fontSize: '14px' }}>
                            <strong>注意：</strong>转换效果取决于 PDF 源文件的结构。<br />
                            扫描件, 加密文档或复杂版式可能无法完美还原。
                        </p>
                    </div>

                    <button
                        onClick={handleConvert}
                        disabled={processing}
                        style={{
                            width: '100%',
                            padding: '18px',
                            border: 'none',
                            borderRadius: '16px',
                            background: processing ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                            color: processing ? 'var(--text-secondary)' : 'white',
                            fontSize: '17px',
                            fontWeight: '600',
                            cursor: processing ? 'not-allowed' : 'pointer',
                            boxShadow: processing ? 'none' : '0 10px 20px rgba(0, 122, 255, 0.3)',
                            transition: 'all 0.3s ease',
                            marginTop: 'auto',
                            letterSpacing: '-0.3px',
                            flexShrink: 0
                        }}
                        onMouseEnter={(e) => {
                            if (!processing) {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 14px 24px rgba(0, 122, 255, 0.4)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!processing) {
                                e.currentTarget.style.transform = 'none';
                                e.currentTarget.style.boxShadow = '0 10px 20px rgba(0, 122, 255, 0.3)';
                            }
                        }}
                    >
                        {processing ? '转换中...' : '开始转换'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default ConvertFormat;
