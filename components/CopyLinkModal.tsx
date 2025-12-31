import React, { useEffect, useRef, useState } from 'react';
import Button from './Button';

interface Props {
  open: boolean;
  url: string;
  title?: string;
  onClose: () => void;
}

const CopyLinkModal: React.FC<Props> = ({ open, url, title = '分享链接', onClose }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
  }, [open, url]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      return;
    } catch {
      try {
        inputRef.current?.select();
        document.execCommand('copy');
        setCopied(true);
      } catch {
        setCopied(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[26000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 overlay-fade-in">
      <div className="bg-white border-4 border-black shadow-2xl max-w-lg w-full p-6 space-y-4 modal-scale-in">
        <div className="flex items-center justify-between">
          <div className="text-lg font-black tracking-tight">{title}</div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-black hover:text-white transition-colors text-xl leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="text-xs font-mono-tech text-gray-500">
          链接已生成，请手动复制分享给朋友
        </div>
        <input
          ref={inputRef}
          value={url}
          readOnly
          className="w-full border-2 border-black px-3 py-2 text-xs font-mono-tech bg-white"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button onClick={copy} className="w-full">
            {copied ? '已复制' : '复制链接'}
          </Button>
          <Button onClick={onClose} variant="secondary" className="w-full">
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CopyLinkModal;
