export interface PDFInfo {
    pageCount: number;
    title: string;
    author: string;
}

export interface SplitRange {
    start: number;
    end: number;
    name: string;
}

export interface WatermarkOptions {
    size: number;
    opacity: number;
    color: string;
    rotate: number;
}

declare global {
    interface Window {
        pdfApi?: {
            getPDFInfo: (path: string) => Promise<PDFInfo>;
            splitPDFByPage: (path: string, outputDir: string, prefix?: string) => Promise<string[]>;
            splitPDFByRanges: (path: string, ranges: SplitRange[], outputDir: string) => Promise<string[]>;
            mergePDFs: (files: string[], outputDir: string, fileName?: string) => Promise<string>;
            watermarkPDF: (path: string, text: string, options: WatermarkOptions, outputDir: string) => Promise<string>;
            extractImages: (path: string, outputDir: string) => Promise<string[]>;
            pdfToImage: (path: string, outputDir: string) => Promise<string[]>;
            convertPDFToWord: (path: string, outputDir: string) => Promise<string>;
            convertPDFToPPT: (path: string, outputDir: string) => Promise<string>;
            convertPDFToExcel: (path: string, outputDir: string) => Promise<string>;
        };

    }
}
