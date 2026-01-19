import React, { useState } from 'react';
import { Combine, Plus, X, FileText } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import '../types';

const MergePDF: React.FC = () => {
    const { dialog, shell, notification, system } = useIntools('pdf-tools');
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
        <div style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Combine color="var(--primary-color)" /> PDF 合并
            </h2>

            <div
                onClick={handleAddFiles}
                style={{
                    background: 'rgba(255,255,255,0.4)',
                    borderRadius: 'var(--radius-md)',
                    padding: '30px',
                    textAlign: 'center',
                    border: '2px dashed var(--glass-border)',
                    cursor: 'pointer',
                    marginBottom: '20px',
                    transition: 'all 0.2s'
                }}
            >
                <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
                    <Plus size={32} color="var(--primary-color)" />
                </div>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>点击添加 PDF 文件</p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px' }}>
                {files.map((file, index) => (
                    <div key={file} style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '12px',
                        background: 'rgba(255,255,255,0.5)',
                        marginBottom: '8px',
                        borderRadius: 'var(--radius-sm)',
                        gap: '12px'
                    }}>
                        <FileText size={20} color="var(--text-secondary)" />
                        <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {file.split('/').pop()}
                        </span>

                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={(e) => { e.stopPropagation(); moveFile(index, 'up'); }} disabled={index === 0} style={{ border: 'none', background: 'transparent', cursor: 'pointer', opacity: index === 0 ? 0.3 : 1 }}>↑</button>
                            <button onClick={(e) => { e.stopPropagation(); moveFile(index, 'down'); }} disabled={index === files.length - 1} style={{ border: 'none', background: 'transparent', cursor: 'pointer', opacity: index === files.length - 1 ? 0.3 : 1 }}>↓</button>
                            <button onClick={(e) => { e.stopPropagation(); handleRemoveFile(index); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'red' }}><X size={16} /></button>
                        </div>
                    </div>
                ))}
            </div>

            <button
                onClick={handleMerge}
                disabled={files.length < 2 || merging}
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
                    cursor: files.length < 2 || merging ? 'not-allowed' : 'pointer',
                    opacity: files.length < 2 || merging ? 0.7 : 1
                }}
            >
                {merging ? '合并中...' : `开始合并 (${files.length} 个文件)`}
            </button>
        </div>
    );
};

export default MergePDF;
