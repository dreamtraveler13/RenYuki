'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';

export const POLICY_TEXT = `用户须知与免责声明（强制阅读）

1. 性质与用途
- 本站提供 AI 生成内容的演示与娱乐服务，仅供个人学习、创作参考与娱乐体验。
- 生成内容具有不确定性，可能包含错误或不当信息，不构成任何事实陈述或官方立场。

2. 严格禁止内容（重点）
你承诺绝不上传、输入、引导或生成（包括文字/图片/音频/链接/暗示性指令/变体拼写/谐音/截图/二维码等规避形式）：
- 任何违反中华人民共和国法律法规及相关规定的内容；
- 任何政治敏感信息、煽动性内容、谣言、极端化内容；
- 色情、涉未成年人不当内容、暴力血腥、恐怖、赌博、毒品、诈骗、侵权盗版、违法交易、个人隐私泄露等；
- 任何可能引发人身伤害、自残自杀、违法犯罪的指令或教程。

3. 用户责任与承诺
- 你对你上传/输入的全部内容及其合法性承担全部责任。
- 你确认拥有上传素材的合法权利（著作权/肖像权/授权等），并保证不侵犯任何第三方合法权益。
- 因你上传/输入/传播内容引发的争议、投诉、处罚或损失，由你自行承担并负责解决。

4. 平台管理措施
- 平台可能对输入与输出进行自动化审核、过滤、拦截与记录，以履行合规与安全义务。
- 若你尝试生成禁止内容，平台将采取警告、限制功能、封禁账号等措施；你同意平台对此拥有最终处置权。

5. 输出内容的使用限制
- 你不得将本站生成内容用于违法用途、对外传播敏感信息、误导公众或造成社会影响的场景。
- 你不得声称生成内容来自官方/权威机构，不得用于冒充、诽谤、造谣或侵害他人名誉。

6. 免责与责任限制
- 平台不保证生成内容的准确性、完整性、合法性或适用性；你应自行判断并承担使用后果。
- 因不可抗力、网络故障、第三方服务故障、模型不稳定等导致的中断或损失，平台在法律允许范围内不承担责任。

7. 同意与生效
- 你点击“我已阅读并同意”即表示已完整阅读并理解本声明全部条款，并同意接受约束。
- 若不同意，请停止使用并退出。`;

export const PolicyModal: React.FC<{
  open: boolean;
  version: number | null;
  onDecline: () => void;
  onAccepted: (version: number) => Promise<void>;
}> = ({ open, version, onDecline, onAccepted }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setScrolledToBottom(false);
    setChecked(false);
    setSubmitting(false);
    setError(null);
    if (boxRef.current) boxRef.current.scrollTop = 0;
  }, [open]);

  if (!open) return null;

  const content = (
    <div className="fixed inset-0 z-[25000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overlay-fade-in">
      <div className="w-full max-w-2xl bg-white border border-black/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.18)] overflow-hidden modal-scale-in">
        <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">首次生成前请阅读并同意免责声明</div>
          <button onClick={onDecline} className="text-xl leading-none text-gray-500 hover:text-gray-900 transition-colors">
            ×
          </button>
        </div>
        <div
          ref={boxRef}
          className="max-h-[60vh] overflow-y-auto px-5 py-4 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap"
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
            if (atBottom) setScrolledToBottom(true);
          }}
        >
          {POLICY_TEXT}
        </div>
        <div className="px-5 py-4 border-t border-black/10 space-y-3">
          <label className="flex items-start gap-2 text-xs text-gray-700 select-none">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5"
              disabled={!scrolledToBottom || submitting}
            />
            <span>
              我已完整阅读并同意上述免责声明（版本 {version ?? '-'}），并承诺不生成任何违法/政治敏感等禁止内容。
            </span>
          </label>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              onClick={async () => {
                if (!scrolledToBottom) {
                  setError('请先滚动到最底部后再继续。');
                  return;
                }
                if (!checked) {
                  setError('请勾选“我已阅读并同意”。');
                  return;
                }
                if (!version) {
                  setError('免责声明版本获取失败，请刷新页面重试。');
                  return;
                }
                setSubmitting(true);
                setError(null);
                try {
                  await onAccepted(version);
                } catch (e: any) {
                  setError(e?.message || '提交失败，请稍后重试。');
                  setSubmitting(false);
                  return;
                }
                setSubmitting(false);
              }}
              className="w-full"
            >
              {submitting ? '提交中…' : '我已阅读并同意'}
            </Button>
            <Button onClick={onDecline} variant="secondary" className="w-full">
              暂不同意（返回）
            </Button>
          </div>
          <div className="text-[10px] text-gray-500">
            为合规与安全，平台会记录同意时间与免责声明版本号，并可能记录必要的安全日志。
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
};

export default PolicyModal;
