
export class HuffmanNode {
    char: string | null;
    freq: number;
    left: HuffmanNode | null;
    right: HuffmanNode | null;

    constructor(char: string | null, freq: number, left: HuffmanNode | null = null, right: HuffmanNode | null = null) {
        this.char = char;
        this.freq = freq;
        this.left = left;
        this.right = right;
    }
}

export class HuffmanCoder {
    root: HuffmanNode | null = null;
    codes: Map<string, string> = new Map();
    reverseCodes: Map<string, string> = new Map();

    buildTree(text: string) {
        if (!text) return;

        const freqMap = new Map<string, number>();
        for (const char of text) {
            freqMap.set(char, (freqMap.get(char) || 0) + 1);
        }

        const pq: HuffmanNode[] = [];
        freqMap.forEach((freq, char) => {
            pq.push(new HuffmanNode(char, freq));
        });

        pq.sort((a, b) => a.freq - b.freq);

        while (pq.length > 1) {
            const left = pq.shift()!;
            const right = pq.shift()!;
            const parent = new HuffmanNode(null, left.freq + right.freq, left, right);

            // Insert back keeping sorted order
            let i = 0;
            while (i < pq.length && pq[i].freq < parent.freq) i++;
            pq.splice(i, 0, parent);
        }

        this.root = pq[0];
        this.codes.clear();
        this.generateCodes(this.root, "");

        // Create reverse map for decoding
        this.reverseCodes.clear();
        this.codes.forEach((code, char) => {
            this.reverseCodes.set(code, char);
        });
    }

    generateCodes(node: HuffmanNode | null, code: string) {
        if (!node) return;
        if (node.char !== null) {
            this.codes.set(node.char, code);
            return;
        }
        this.generateCodes(node.left, code + "0");
        this.generateCodes(node.right, code + "1");
    }

    encode(text: string): string {
        if (!this.root && text.length > 0) {
            this.buildTree(text);
        }
        return text.split('').map(c => this.codes.get(c) || '').join('');
    }

    getCodes(): { [key: string]: string } {
        const result: { [key: string]: string } = {};
        this.codes.forEach((val, key) => result[key] = val);
        return result;
    }
}
