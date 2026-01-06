import React, { useEffect, useRef, useState } from 'react';
import Button from './Button';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SupportModal: React.FC<Props> = ({ open, onClose }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);
  const email = 'support@renyuki.cc';

  useEffect(() => {
    if (!open) return;
    setCopied(false);
  }, [open]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
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

  const sendMail = () => {
    window.location.href = `mailto:${email}`;
  };

  return (
    <div className="fixed inset-0 z-[26000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 overlay-fade-in">
      <div className="bg-white border-4 border-black shadow-2xl max-w-lg w-full p-6 space-y-4 modal-scale-in">
        <div className="flex items-center justify-between">
          <div className="text-lg font-black tracking-tight">反馈与建议</div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-black hover:text-white transition-colors text-xl leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="text-sm text-gray-800 leading-relaxed">
           遇到问题，或者有好的想法？<br/>
           每一条反馈都会被认真对待。因站长为初中生，工作日回复可能有所延迟，敬请理解。<br/>
        </div>
        <input
          ref={inputRef}
          value={email}
          readOnly
          className="w-full border-2 border-black px-3 py-2 text-sm font-mono-tech bg-gray-50 text-center"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button onClick={copy} variant="secondary" className="w-full">
            {copied ? '已复制邮箱' : '复制邮箱'}
          </Button>
          <Button onClick={sendMail} className="w-full">
            发送邮件
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SupportModal;
