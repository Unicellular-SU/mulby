import { useEffect, useState } from 'react'
import { Converter } from './utils/converter'
import { HuffmanCoder } from './utils/huffman'
import './styles.css'

// Icons
const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
)

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
)

// UI Components
const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await window.mulby?.clipboard?.writeText(text);
      setCopied(true);
      window.mulby?.notification?.show('已复制到剪贴板', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };

  return (
    <button
      className={`copy-btn ${copied ? 'copied' : ''}`}
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
};

const Section = ({ title, children, actions }: { title: string, children: React.ReactNode, actions?: React.ReactNode }) => (
  <div className="section">
    <div className="section-header">
      <span className="label">{title}</span>
      {actions}
    </div>
    {children}
  </div>
);

const TextArea = ({
  value,
  onChange,
  readOnly,
  placeholder,
  rows = 3
}: {
  value: string,
  onChange?: (val: string) => void,
  readOnly?: boolean,
  placeholder?: string,
  rows?: number
}) => (
  <div className="textarea-wrapper">
    <textarea
      rows={rows}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      readOnly={readOnly}
      placeholder={placeholder}
    />
    {readOnly && value && <div className="textarea-actions"><CopyButton text={value} /></div>}
  </div>
);

type Tab = 'charset' | 'transport' | 'url' | 'huffman';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('charset');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Charset State
  const [charInput, setCharInput] = useState('');
  const [utf8Hex, setUtf8Hex] = useState('');
  const [gbkHex, setGbkHex] = useState('');

  // Transport State
  const [transInput, setTransInput] = useState('');
  const [base64Out, setBase64Out] = useState('');
  const [hexOut, setHexOut] = useState('');

  // URL State
  const [urlInput, setUrlInput] = useState('');
  const [urlOutput, setUrlOutput] = useState('');
  const [urlError, setUrlError] = useState('');

  // Huffman State
  const [huffInput, setHuffInput] = useState('');
  const [huffEncoded, setHuffEncoded] = useState('');
  const [huffTree, setHuffTree] = useState<{ [key: string]: string }>({});
  const [compressionRatio, setCompressionRatio] = useState(0);

  // Initialize Theme and Listeners
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const t = (search.get('theme') as 'light' | 'dark') || 'light';
    setTheme(t);

    window.mulby?.onThemeChange?.((newTheme) => {
      setTheme(newTheme);
    });

    // Handle initial input from Mulby if any
    window.mulby?.onPluginInit?.((data) => {
      if (data.input) {
        // Default to charset tab and populate input
        setCharInput(data.input);
        handleCharChange(data.input);
      }
    });
  }, []);

  // Apply Theme to DOM
  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, [theme]);

  // -- Handlers --

  // Charset
  const handleCharChange = (val: string) => {
    setCharInput(val);
    if (!val) {
      setUtf8Hex('');
      setGbkHex('');
      return;
    }
    try {
      setUtf8Hex(Converter.utf8ToHex(val));
      setGbkHex(Converter.gbkToHex(val));
    } catch (e) {
      console.error(e);
    }
  };

  // Transport
  const updateFromText = (text: string) => {
    setTransInput(text);
    if (!text) {
      setBase64Out('');
      setHexOut('');
      return;
    }
    setBase64Out(Converter.textToBase64(text));
    setHexOut(Converter.utf8ToHex(text));
  }

  const updateFromBase64 = (b64: string) => {
    setBase64Out(b64);
    if (!b64) {
      setTransInput('');
      setHexOut('');
      return;
    }
    const text = Converter.base64ToText(b64);
    setTransInput(text);
    if (text === 'Invalid Base64') {
      setHexOut('Invalid');
    } else {
      setHexOut(Converter.utf8ToHex(text));
    }
  }

  const updateFromHex = (hex: string) => {
    setHexOut(hex);
    if (!hex) {
      setTransInput('');
      setBase64Out('');
      return;
    }
    const text = Converter.hexToUtf8(hex);
    setTransInput(text);
    if (text === 'Invalid Hex') {
      setBase64Out('Invalid');
    } else {
      setBase64Out(Converter.textToBase64(text));
    }
  }

  // URL
  const handleUrlInput = (val: string) => {
    setUrlInput(val);
    setUrlError('');
    try {
      setUrlOutput(encodeURIComponent(val));
    } catch (e) {
      setUrlOutput('');
    }
  };

  const handleUrlOutput = (val: string) => {
    setUrlOutput(val);
    setUrlError('');
    try {
      setUrlInput(decodeURIComponent(val));
    } catch (e) {
      setUrlError('Malformated URI sequence');
    }
  };

  // Huffman
  const handleHuffman = (val: string) => {
    setHuffInput(val);
    if (!val) {
      setHuffEncoded('');
      setHuffTree({});
      setCompressionRatio(0);
      return;
    }
    try {
      const coder = new HuffmanCoder();
      coder.buildTree(val);
      const encoded = coder.encode(val);
      setHuffEncoded(encoded);
      setHuffTree(coder.getCodes());

      const originalBits = val.length * 8;
      const compressedBits = encoded.length;
      const ratio = originalBits > 0 ? (1 - compressedBits / originalBits) * 100 : 0;
      setCompressionRatio(ratio);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="app">
      <div className="tabs">
        {(['charset', 'transport', 'url', 'huffman'] as Tab[]).map((t) => (
          <div
            key={t}
            className={`tab ${activeTab === t ? 'active' : ''}`}
            onClick={() => setActiveTab(t)}
          >
            {t === 'charset' && '字符编码'}
            {t === 'transport' && '二进制传输'}
            {t === 'url' && 'URL 编码'}
            {t === 'huffman' && '哈夫曼编码'}
          </div>
        ))}
      </div>

      <div className="container">
        {activeTab === 'charset' && (
          <>
            <Section title="输入文本 (Text)">
              <TextArea value={charInput} onChange={handleCharChange} placeholder="输入包含中文、英文、符号的文本..." />
            </Section>
            <Section title="UTF-8 (Hex)">
              <TextArea value={utf8Hex} readOnly />
            </Section>
            <Section title="GBK (Hex)">
              <TextArea value={gbkHex} readOnly />
            </Section>
          </>
        )}

        {activeTab === 'transport' && (
          <>
            <Section title="文本 (Text)">
              <TextArea value={transInput} onChange={updateFromText} placeholder="Plain Text..." />
            </Section>
            <Section title="Base64">
              <TextArea value={base64Out} onChange={updateFromBase64} placeholder="Base64 Encoded..." />
            </Section>
            <Section title="Hex (UTF-8)">
              <TextArea value={hexOut} onChange={updateFromHex} placeholder="Hex String..." />
            </Section>
          </>
        )}

        {activeTab === 'url' && (
          <>
            <Section title="Decoded">
              <TextArea rows={4} value={urlInput} onChange={handleUrlInput} placeholder="https://example.com/foo bar" />
            </Section>

            <div className="divider">
              <span>⇅</span>
            </div>

            <Section title="Encoded">
              <TextArea rows={4} value={urlOutput} onChange={handleUrlOutput} placeholder="https%3A%2F%2Fexample.com%2Ffoo%20bar" />
            </Section>
            {urlError && <div className="error-msg">{urlError}</div>}
          </>
        )}

        {activeTab === 'huffman' && (
          <>
            <Section title="输入文本">
              <TextArea value={huffInput} onChange={handleHuffman} placeholder="输入一段文本以生成哈夫曼编码..." />
            </Section>

            <Section title="压缩统计">
              <div className="stats-card">
                <div className="stat-item">
                  <span className="stat-label">Original Bits:</span>
                  <span className="stat-value">{huffInput.length * 8}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Compressed Bits:</span>
                  <span className="stat-value">{huffEncoded.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Compression Ratio:</span>
                  <span className="stat-value highlight">{compressionRatio.toFixed(2)}%</span>
                </div>
              </div>
            </Section>

            <Section title="Result (Binary String)">
              <TextArea value={huffEncoded} readOnly />
            </Section>

            <Section title="编码表 (Huffman Tree Codes)">
              <div className="code-view">
                {Object.keys(huffTree).length === 0 ? <span className="placeholder">暂无数据</span> :
                  Object.entries(huffTree).map(([char, code]) => (
                    <div key={char} className="code-item">
                      <span className="char">{JSON.stringify(char)}</span>
                      <span className="arrow">→</span>
                      <span className="code">{code}</span>
                    </div>
                  ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
