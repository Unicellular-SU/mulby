
import { Buffer } from 'buffer';
import iconv from 'iconv-lite';

export const Converter = {
    // UTF-8
    utf8ToHex: (str: string): string => {
        return Buffer.from(str, 'utf8').toString('hex');
    },

    hexToUtf8: (hex: string): string => {
        try {
            return Buffer.from(hex, 'hex').toString('utf8');
        } catch (e) {
            return 'Invalid Hex';
        }
    },

    // GBK
    gbkToHex: (str: string): string => {
        return iconv.encode(str, 'gbk').toString('hex');
    },

    hexToGbk: (hex: string): string => {
        try {
            const buf = Buffer.from(hex, 'hex');
            return iconv.decode(buf, 'gbk');
        } catch (e) {
            return 'Invalid Hex';
        }
    },

    // Base64
    textToBase64: (str: string): string => {
        return Buffer.from(str, 'utf8').toString('base64');
    },

    base64ToText: (b64: string): string => {
        try {
            return Buffer.from(b64, 'base64').toString('utf8');
        } catch (e) {
            return 'Invalid Base64';
        }
    },

    hexToBase64: (hex: string): string => {
        try {
            return Buffer.from(hex, 'hex').toString('base64');
        } catch (e) {
            return 'Invalid Hex';
        }
    },

    base64ToHex: (b64: string): string => {
        try {
            return Buffer.from(b64, 'base64').toString('hex');
        } catch (e) {
            return 'Invalid Base64';
        }
    }
};
