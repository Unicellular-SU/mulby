// preload.cjs - PDF 处理 API
// 使用 CommonJS 格式，放在项目根目录，不需要打包

const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

// 暴露 PDF 处理 API 给渲染进程
window.pdfApi = {
    /**
     * 获取 PDF 文件信息
     * @param {string} pdfPath - PDF 文件路径
     * @returns {Promise<{pageCount: number, title: string, author: string}>}
     */
    getPDFInfo: async (pdfPath) => {
        try {
            const pdfBytes = await fs.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);

            return {
                pageCount: pdf.getPageCount(),
                title: pdf.getTitle() || '',
                author: pdf.getAuthor() || '',
                subject: pdf.getSubject() || '',
                creator: pdf.getCreator() || '',
            };
        } catch (error) {
            throw new Error(`获取PDF信息失败: ${error.message}`);
        }
    },

    /**
     * 自动拆分 PDF - 每页一个文件
     * @param {string} pdfPath - 输入 PDF 文件路径
     * @param {string} outputDir - 输出目录
     * @param {string} [prefix] - 文件名前缀
     * @returns {Promise<string[]>} - 输出文件路径数组
     */
    splitPDFByPage: async (pdfPath, outputDir, prefix = 'page') => {
        try {
            const pdfBytes = await fs.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            const pageCount = pdf.getPageCount();
            const outputPaths = [];

            // 确保输出目录存在
            await fs.mkdir(outputDir, { recursive: true });

            for (let i = 0; i < pageCount; i++) {
                const newPdf = await PDFDocument.create();
                const [copiedPage] = await newPdf.copyPages(pdf, [i]);
                newPdf.addPage(copiedPage);

                const newPdfBytes = await newPdf.save();
                const outputPath = path.join(outputDir, `${prefix}_${i + 1}.pdf`);
                await fs.writeFile(outputPath, newPdfBytes);
                outputPaths.push(outputPath);
            }

            return outputPaths;
        } catch (error) {
            throw new Error(`自动拆分PDF失败: ${error.message}`);
        }
    },

    /**
     * 手动拆分 PDF - 按指定页面范围
     * @param {string} pdfPath - 输入 PDF 文件路径
     * @param {Array<{start: number, end: number, name: string}>} ranges - 页面范围数组
     * @param {string} outputDir - 输出目录
     * @returns {Promise<string[]>} - 输出文件路径数组
     */
    splitPDFByRanges: async (pdfPath, ranges, outputDir) => {
        try {
            const pdfBytes = await fs.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            const pageCount = pdf.getPageCount();
            const outputPaths = [];

            // 确保输出目录存在
            await fs.mkdir(outputDir, { recursive: true });

            for (const range of ranges) {
                const { start, end, name } = range;

                // 验证页面范围
                if (start < 1 || end > pageCount || start > end) {
                    throw new Error(`无效的页面范围: ${start}-${end}`);
                }

                const newPdf = await PDFDocument.create();
                const pageIndices = [];

                for (let i = start - 1; i < end; i++) {
                    pageIndices.push(i);
                }

                const copiedPages = await newPdf.copyPages(pdf, pageIndices);
                copiedPages.forEach((page) => newPdf.addPage(page));

                const newPdfBytes = await newPdf.save();
                const fileName = name.endsWith('.pdf') ? name : `${name}.pdf`;
                const outputPath = path.join(outputDir, fileName);
                await fs.writeFile(outputPath, newPdfBytes);
                outputPaths.push(outputPath);
            }

            return outputPaths;
        } catch (error) {
            throw new Error(`手动拆分PDF失败: ${error.message}`);
        }
    },

    /**
     * 提取指定页面
     * @param {string} pdfPath - 输入 PDF 文件路径
     * @param {number[]} pageNumbers - 要提取的页面编号数组 (1-based)
     * @param {string} outputPath - 输出文件路径
     * @returns {Promise<string>} - 输出文件路径
     */
    extractPages: async (pdfPath, pageNumbers, outputPath) => {
        try {
            const pdfBytes = await fs.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            const pageCount = pdf.getPageCount();

            const newPdf = await PDFDocument.create();
            const pageIndices = pageNumbers
                .filter(n => n >= 1 && n <= pageCount)
                .map(n => n - 1);

            if (pageIndices.length === 0) {
                throw new Error('没有有效的页面编号');
            }

            const copiedPages = await newPdf.copyPages(pdf, pageIndices);
            copiedPages.forEach((page) => newPdf.addPage(page));

            const newPdfBytes = await newPdf.save();
            await fs.writeFile(outputPath, newPdfBytes);

            return outputPath;
        } catch (error) {
            throw new Error(`提取页面失败: ${error.message}`);
        }
    },
};

console.log('[PDF Tools] Preload API 已加载');
