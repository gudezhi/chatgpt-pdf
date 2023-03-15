// export const PDFData: {pageNum: number, str: string}[]=[];

import { createSignal } from 'solid-js';

// 前端共享
export interface PDFDataType {
    pdfID: string;
    text: { str: string; pageNum: number; }[];
}

export const [PDFData, setPDFData] = createSignal<PDFDataType>();
