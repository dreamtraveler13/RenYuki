'use client';

import Link from 'next/link';

export default function PayReturnPage() {
  return (
    <div className="w-screen h-screen bg-[#f7f7f8] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-black/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.10)] p-6">
        <div className="text-xl font-semibold text-gray-900">支付完成</div>
        <div className="mt-2 text-sm text-gray-600 leading-relaxed">
          支付平台可能会有延迟。回到 RenYuki 后，打开“购买嘎拉币”并点击“同步到账”即可更新余额。
        </div>
        <div className="mt-5 flex gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-gray-900 text-white text-sm font-semibold px-4 py-2 hover:bg-black transition-colors"
          >
            返回 RenYuki
          </Link>
        </div>
        <div className="mt-4 text-[11px] text-gray-500">如遇问题，可稍后再次同步订单。</div>
      </div>
    </div>
  );
}

