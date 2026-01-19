import React, { useState } from 'react';
import { Combine, Plus, X, FileText } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import { pdfService } from '../services/PDFService';
import '../types';

const FileItem: React.FC<{
    file: string;
    index: number;
    total: number;
    onMove: (index: number, direction: 'up' | 'down') => void;
    onRemove: (index: number) => void;
}> = ({ file, index, total, onMove, onRemove }) => {
    const [preview, setPreview] = React.useState<string | null>(null);

    React.useEffect(() => {
        pdfService.renderPageToDataURL(file, 1, 0.2).then(setPreview).catch(console.error);
    }, [file]);

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(10px)',
            marginBottom: '10px',
            borderRadius: '16px',
            gap: '16px',
            border: '1px solid rgba(255,255,255,0.4)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            cursor: 'grab'
        }}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.4)';
            }}
        >
            <div style={{
                width: '44px',
                height: '56px',
                background: '#fff',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden',
                flexShrink: 0
            }}>
                {preview ? (
                    <img src={preview} alt="Thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <FileText size={24} color="var(--primary-color)" />
                )}
            </div>

            <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.split(/[/\\]/).pop()}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Page 1
                </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={(e) => { e.stopPropagation(); onMove(index, 'up'); }} disabled={index === 0} style={{
                    border: 'none', background: 'rgba(0,0,0,0.05)', borderRadius: '8px', width: '32px', height: '32px',
                    cursor: index === 0 ? 'default' : 'pointer', opacity: index === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>↑</button>
                <button onClick={(e) => { e.stopPropagation(); onMove(index, 'down'); }} disabled={index === total - 1} style={{
                    border: 'none', background: 'rgba(0,0,0,0.05)', borderRadius: '8px', width: '32px', height: '32px',
                    cursor: index === total - 1 ? 'default' : 'pointer', opacity: index === total - 1 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>↓</button>
                <button onClick={(e) => { e.stopPropagation(); onRemove(index); }} style={{
                    border: 'none', background: 'rgba(255, 59, 48, 0.1)', borderRadius: '8px', width: '32px', height: '32px',
                    cursor: 'pointer', color: '#FF3B30', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}><X size={18} /></button>
            </div>
        </div>
    );
};

const MergePDF: React.FC = () => {
    const { dialog, notification, system } = useIntools('pdf-tools');
    const [files, setFiles] = useState<string[]>([]);
    const [merging, setMerging] = useState(false);

    const handleAddFiles = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 PDF 文件',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            properties: ['openFile', 'multiSelections']
        });

        if (result && result.length > 0) {
            // Filter duplicates
            const newFiles = result.filter(f => !files.includes(f));
            setFiles([...files, ...newFiles]);
        }
    };

    const handleRemoveFile = (index: number) => {
        const newFiles = [...files];
        newFiles.splice(index, 1);
        setFiles(newFiles);
    };

    const handleMerge = async () => {
        if (files.length < 2) {
            notification.show('请至少选择两个文件进行合并', 'warning');
            return;
        }

        try {
            setMerging(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.'; // Fallback

            const outputPath = await window.pdfApi?.mergePDFs(files, outputDir);

            if (outputPath) {
                notification.show('合并成功！', 'success');
                // shell.showItemInFolder(outputPath); // Prevent hiding window
                setFiles([]); // Clear after success
            }
        } catch (error: any) {
            notification.show(`合并失败: ${error.message}`, 'error');
        } finally {
            setMerging(false);
        }
    };

    const moveFile = (index: number, direction: 'up' | 'down') => {
        if ((direction === 'up' && index === 0) || (direction === 'down' && index === files.length - 1)) return;

        const newFiles = [...files];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        [newFiles[index], newFiles[targetIndex]] = [newFiles[targetIndex], newFiles[index]];
        setFiles(newFiles);
    };

    return (
        <div style={{ padding: '10px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ marginBottom: '24px', fontSize: '28px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '12px', letterSpacing: '-0.5px' }}>
                <Combine color="var(--primary-color)" size={32} /> PDF 合并
            </h2>

            <div
                onClick={handleAddFiles}
                style={{
                    background: 'rgba(255,255,255,0.5)',
                    borderRadius: '20px',
                    padding: '40px',
                    textAlign: 'center',
                    border: '2px dashed rgba(0, 122, 255, 0.3)',
                    cursor: 'pointer',
                    marginBottom: '24px',
                    transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 122, 255, 0.05)';
                    e.currentTarget.style.borderColor = 'var(--primary-color)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
                    e.currentTarget.style.borderColor = 'rgba(0, 122, 255, 0.3)';
                }}
            >
                <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                    <div style={{ padding: '16px', background: 'var(--primary-color)', borderRadius: '50%', boxShadow: '0 8px 16px rgba(0, 122, 255, 0.2)' }}>
                        <Plus size={32} color="white" />
                    </div>
                </div>
                <p style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>点击添加 PDF 文件</p>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>支持多选 / 拖拽上传</p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px' }}>
                {files.map((file, index) => (
                    <FileItem key={file} file={file} index={index} total={files.length} onMove={moveFile} onRemove={handleRemoveFile} />
                ))}
            </div>

            <button
                onClick={handleMerge}
                disabled={files.length < 2 || merging}
                style={{
                    width: '100%',
                    padding: '18px',
                    border: 'none',
                    borderRadius: '16px',
                    background: files.length < 2 || merging ? 'rgba(0,0,0,0.05)' : 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                    color: files.length < 2 || merging ? 'var(--text-secondary)' : 'white',
                    fontSize: '17px',
                    fontWeight: '600',
                    cursor: files.length < 2 || merging ? 'not-allowed' : 'pointer',
                    boxShadow: files.length < 2 || merging ? 'none' : '0 10px 20px rgba(0, 122, 255, 0.3)',
                    transition: 'all 0.3s ease',
                    marginTop: 'auto',
                    letterSpacing: '-0.3px'
                }}
                onMouseEnter={(e) => {
                    if (files.length >= 2 && !merging) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 14px 24px rgba(0, 122, 255, 0.4)';
                    }
                }}
                onMouseLeave={(e) => {
                    if (files.length >= 2 && !merging) {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.boxShadow = '0 10px 20px rgba(0, 122, 255, 0.3)';
                    }
                }}
            >
                {merging ? '合并中...' : `开始合并 (${files.length} 个文件)`}
            </button>
        </div>
    );
};

export default MergePDF;
