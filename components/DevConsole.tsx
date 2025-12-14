'use client';

import React, { useEffect, useRef, useState } from 'react';
import Button from './Button';
import { generateGameScript, generateHeroineSprite, generateProtagonistSprite, fileToBase64 } from '../services/aiService';
import { downloadEdgeTaskResult, getEdgeTaskStatus, startEdgeTask, triggerJsonDownload } from '../services/edgeoneTasks';

interface Props {
  authKey: string;
  onExit: () => void;
}

const DevConsole: React.FC<Props> = ({ authKey, onExit }) => {
  const [activeTab, setActiveTab] = useState<'script' | 'image' | 'audio' | 'edge'>('script');
  const [log, setLog] = useState<string[]>([]);
  
  // Script State
  const [scriptProtagonist, setScriptProtagonist] = useState('Player');
  const [scriptHeroine, setScriptHeroine] = useState('Yuki');
  const [scriptPlot, setScriptPlot] = useState('Rooftop confession');
  const [scriptOutput, setScriptOutput] = useState('');
  const [rawJsonOutput, setRawJsonOutput] = useState('');

  // Image State
  const [imageType, setImageType] = useState<'protagonist' | 'heroine'>('protagonist');
  const [imageEmotion, setImageEmotion] = useState('happy');
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [cutPreview, setCutPreview] = useState<string | null>(null);
  const [isCutting, setIsCutting] = useState(false);

  // Audio State
  const [ttsText, setTtsText] = useState('おはようございます、先輩！');
  const [ttsStatus, setTtsStatus] = useState('');

  // EdgeOne async pipeline state
  const [edgePayload, setEdgePayload] = useState(
    JSON.stringify(
      {
        protagonistName: 'Edge Tester',
        heroineName: 'Yuki',
        plotDescription: 'EdgeOne async demo',
      },
      null,
      2
    )
  );
  const [edgeTaskId, setEdgeTaskId] = useState('');
  const [edgeStatus, setEdgeStatus] = useState<'idle' | 'pending' | 'running' | 'done' | 'error'>('idle');
  const [edgeError, setEdgeError] = useState<string>('');
  const edgePollTimer = useRef<number | null>(null);

  const formatEdgeStatus = (status: string) => {
    switch (status) {
      case 'idle': return '未启动';
      case 'pending': return '等待中';
      case 'running': return '进行中';
      case 'done': return '已完成';
      case 'error': return '失败';
      default: return status;
    }
  };

  const addLog = (msg: string) => setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);

  const stopEdgePolling = () => {
    if (edgePollTimer.current) {
      window.clearTimeout(edgePollTimer.current);
      edgePollTimer.current = null;
    }
  };

  useEffect(() => () => stopEdgePolling(), []);

  // --- Handlers ---

  const handleGenerateScript = async () => {
    addLog(`正在生成剧本：${scriptProtagonist} 与 ${scriptHeroine}…`);
    try {
      const script = await generateGameScript(scriptProtagonist, scriptHeroine, scriptPlot, false);
      setScriptOutput(JSON.stringify(script, null, 2));
      setRawJsonOutput('');
      addLog('剧本生成完成。');
    } catch (e: any) {
      addLog(`错误：${e.message}`);
    }
  };

  const handleGenerateRawJson = async () => {
    addLog(`正在生成原始数据：${scriptProtagonist} 与 ${scriptHeroine}…`);
    try {
      const res = await fetch('/api/dev/generate-raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protagonistName: scriptProtagonist,
          heroineName: scriptHeroine,
          plotDescription: scriptPlot,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        try {
          const err = JSON.parse(text);
          throw new Error(err?.error || `Request failed: ${res.status}`);
        } catch {
          throw new Error(text || `Request failed: ${res.status}`);
        }
      }

      setRawJsonOutput(text);
      addLog('原始数据已生成。');
    } catch (e: any) {
      addLog(`错误：${e.message}`);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const base64 = await fileToBase64(e.target.files[0]);
      setUploadPreview(base64);
      addLog('参考图片已上传。');
    }
  };

  const handleGenerateImage = async () => {
    setIsUploading(true);
    addLog(`正在生成图片：类型=${imageType}，表情=${imageEmotion}…`);
    try {
      let result = '';
      if (imageType === 'protagonist') {
        result = await generateProtagonistSprite(imageEmotion, uploadPreview || undefined, undefined, authKey);
      } else {
        result = await generateHeroineSprite(imageEmotion, undefined, uploadPreview || undefined, authKey);
      }
      setGeneratedImage(result);
      addLog('图片已生成。');
    } catch (e: any) {
      addLog(`错误：${e.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Use the same flood-fill + feathering background removal logic as生产流程
  const removeBackground = async (base64Data: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64Data}`;
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(base64Data);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;

        const visited = new Uint8Array(width * height);
        const stack: number[] = [];

        const START_THRESHOLD = 240;
        const FILL_THRESHOLD = 240;
        const getBrightness = (idx: number) => (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        const isBackgroundCandidate = (idx: number) => {
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          return r > FILL_THRESHOLD && g > FILL_THRESHOLD && b > FILL_THRESHOLD;
        };

        const corners = [0, width - 1, (height - 1) * width, width * height - 1];
        for (const idx of corners) {
          if (getBrightness(idx * 4) > START_THRESHOLD) {
            stack.push(idx);
            visited[idx] = 1;
          }
        }

        while (stack.length > 0) {
          const idx = stack.pop()!;
          const x = idx % width;
          const y = Math.floor(idx / width);
          const neighbors = [];
          if (x > 0) neighbors.push(idx - 1);
          if (x < width - 1) neighbors.push(idx + 1);
          if (y > 0) neighbors.push(idx - width);
          if (y < height - 1) neighbors.push(idx + width);

          for (const nIdx of neighbors) {
            if (visited[nIdx] === 0) {
              const pixelIdx = nIdx * 4;
              if (isBackgroundCandidate(pixelIdx)) {
                visited[nIdx] = 1;
                stack.push(nIdx);
              } else {
                visited[nIdx] = 2;
              }
            }
          }
        }

        for (let i = 0; i < width * height; i++) {
          const pixelIdx = i * 4;
          if (visited[i] === 1) {
            data[pixelIdx + 3] = 0;
          }
        }

        ctx.putImageData(imageData, 0, 0);
        const newBase64 = canvas.toDataURL('image/png').split(',')[1];
        resolve(newBase64);
      };
      img.onerror = () => resolve(base64Data);
    });
  };

  const handleCutPreview = async () => {
    if (!uploadPreview && !generatedImage) {
      addLog('没有可用于扣图的源图片。');
      return;
    }
    setIsCutting(true);
    addLog('正在生成扣图预览…');
    try {
      const target = uploadPreview || generatedImage!;
      const cut = await removeBackground(target);
      setCutPreview(cut);
      addLog('扣图预览已就绪。');
    } catch (e: any) {
      addLog(`扣图失败：${e.message}`);
    } finally {
      setIsCutting(false);
    }
  };

	  const handleTts = async () => {
	    setTtsStatus('已禁用');
	    addLog('语音合成暂时禁用。');
	  };

  const pollEdgeStatus = async (taskId: string) => {
    try {
      const { status, error } = await getEdgeTaskStatus(taskId);
      setEdgeStatus(status);
      setEdgeError(error || '');
	      addLog(`任务 ${taskId} 状态：${formatEdgeStatus(status)}`);
      if (status === 'done' || status === 'error') {
        stopEdgePolling();
      } else {
        edgePollTimer.current = window.setTimeout(() => pollEdgeStatus(taskId), 2500);
      }
    } catch (e: any) {
      addLog(`状态查询失败：${e.message}`);
      edgePollTimer.current = window.setTimeout(() => pollEdgeStatus(taskId), 4000);
    }
  };

  const handleStartEdgeTask = async () => {
    stopEdgePolling();
    try {
      setEdgeError('');
      const parsed = JSON.parse(edgePayload || '{}');
      addLog('正在启动异步任务生成…');
      const taskId = await startEdgeTask(parsed);
      setEdgeTaskId(taskId);
      setEdgeStatus('pending');
      edgePollTimer.current = window.setTimeout(() => pollEdgeStatus(taskId), 1000);
    } catch (e: any) {
      setEdgeError(e.message || '启动失败');
      addLog(`任务错误：${e.message}`);
    }
  };

  const handleManualStatus = async () => {
    if (!edgeTaskId) {
      addLog('尚未创建任务，无法查询。');
      return;
    }
    stopEdgePolling();
    await pollEdgeStatus(edgeTaskId);
  };

  const handleDownloadEdge = async () => {
    if (!edgeTaskId) {
      addLog('尚未创建任务，无法下载。');
      return;
    }
    try {
      const blob = await downloadEdgeTaskResult(edgeTaskId);
      triggerJsonDownload(blob, `嘎拉任务_${edgeTaskId}.json`);
      addLog('已开始下载。');
    } catch (e: any) {
      addLog(`下载失败：${e.message}`);
    }
  };

  return (
    <div className="w-full h-full bg-black text-green-500 font-mono-tech p-4 flex flex-col overflow-hidden">
      {/* Header */}
	      <div className="flex justify-between items-center border-b border-green-800 pb-2 mb-4">
	        <h1 className="text-xl font-bold">开发者控制台</h1>
	        <Button variant="danger" onClick={onExit} className="!py-1 !px-2 text-xs">退出开发者模式</Button>
	      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Sidebar */}
        <div className="w-1/4 border-r border-green-900 pr-4 space-y-2">
	           <button 
	             onClick={() => setActiveTab('script')}
	             className={`w-full text-left p-2 border ${activeTab === 'script' ? 'bg-green-900 border-green-500 text-white' : 'border-green-900 hover:border-green-500'}`}
	           >
	             01. 剧本生成
	           </button>
	           <button 
	             onClick={() => setActiveTab('image')}
	             className={`w-full text-left p-2 border ${activeTab === 'image' ? 'bg-green-900 border-green-500 text-white' : 'border-green-900 hover:border-green-500'}`}
	           >
	             02. 图片生成
	           </button>
	           <button 
	             onClick={() => setActiveTab('audio')}
	             className={`w-full text-left p-2 border ${activeTab === 'audio' ? 'bg-green-900 border-green-500 text-white' : 'border-green-900 hover:border-green-500'}`}
	           >
	             03. 语音（暂不可用）
	           </button>
	           <button 
	             onClick={() => setActiveTab('edge')}
	             className={`w-full text-left p-2 border ${activeTab === 'edge' ? 'bg-green-900 border-green-500 text-white' : 'border-green-900 hover:border-green-500'}`}
	           >
	             04. 异步任务
	           </button>

	           <div className="mt-8 border-t border-green-900 pt-4">
	             <h3 className="text-xs text-green-700 mb-2">系统日志</h3>
	             <div className="h-64 overflow-y-auto text-[10px] space-y-1 bg-black/50 p-2 border border-green-900/50">
	               {log.map((l, i) => <div key={i}>{l}</div>)}
	             </div>
	           </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-green-900/10 p-4 border border-green-900/30">
           
           {/* --- SCRIPT TAB --- */}
           {activeTab === 'script' && (
             <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="block text-xs mb-1">主角名字</label>
                     <input className="w-full bg-black border border-green-700 p-2 text-sm" value={scriptProtagonist} onChange={e => setScriptProtagonist(e.target.value)} />
                   </div>
                   <div>
                     <label className="block text-xs mb-1">女主名字</label>
                     <input className="w-full bg-black border border-green-700 p-2 text-sm" value={scriptHeroine} onChange={e => setScriptHeroine(e.target.value)} />
                   </div>
                </div>
                <div>
                  <label className="block text-xs mb-1">剧情设定</label>
                  <textarea className="w-full bg-black border border-green-700 p-2 text-sm h-20" value={scriptPlot} onChange={e => setScriptPlot(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleGenerateScript} className="flex-1">生成剧本</Button>
                  <Button onClick={handleGenerateRawJson} className="flex-1" variant="secondary">获取原始数据</Button>
                </div>
                
                {scriptOutput && (
                  <div className="mt-4">
                    <label className="block text-xs mb-1">生成结果</label>
                    <textarea className="w-full h-64 bg-black border border-green-700 p-2 text-xs font-mono" readOnly value={scriptOutput} />
                  </div>
                )}

                {rawJsonOutput && (
                  <div className="mt-4">
                    <label className="block text-xs mb-1">原始响应</label>
                    <textarea className="w-full h-64 bg-black border border-green-700 p-2 text-xs font-mono" readOnly value={rawJsonOutput} />
                  </div>
                )}
             </div>
           )}

           {/* --- IMAGE TAB --- */}
           {activeTab === 'image' && (
             <div className="space-y-4">
                <div className="flex gap-4 border-b border-green-800 pb-4">
                   <div className="w-1/3 space-y-4">
                      <div>
                        <label className="block text-xs mb-1">目标角色</label>
                        <select className="w-full bg-black border border-green-700 p-2" value={imageType} onChange={(e: any) => setImageType(e.target.value)}>
                          <option value="protagonist">主角</option>
                          <option value="heroine">女主</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs mb-1">表情标签</label>
                        <input className="w-full bg-black border border-green-700 p-2" value={imageEmotion} onChange={e => setImageEmotion(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs mb-1">上传真人照片（可选）</label>
                        <input type="file" onChange={handleImageUpload} className="text-xs" />
                        {uploadPreview && (
                          <div className="mt-2 w-20 h-20 border border-green-500 overflow-hidden">
                            <img src={`data:image/png;base64,${uploadPreview}`} className="w-full h-full object-cover" alt="上传预览" />
                          </div>
                        )}
                        <Button onClick={handleCutPreview} disabled={isCutting || (!uploadPreview && !generatedImage)} className="w-full mt-2 !py-1 !text-[10px]">
                          {isCutting ? '处理中…' : '扣图预览'}
                        </Button>
                        {cutPreview && (
                          <div className="mt-2 w-20 h-20 border border-green-500 overflow-hidden relative">
                            <div className="absolute inset-0 bg-[linear-gradient(45deg,_#1f1f1f_25%,_transparent_25%),linear-gradient(-45deg,_#1f1f1f_25%,_transparent_25%),linear-gradient(45deg,_transparent_75%,_#1f1f1f_75%),linear-gradient(-45deg,_transparent_75%,_#1f1f1f_75%)] bg-[length:10px_10px] bg-[position:0_0,0_5px,5px_-5px,-5px_0] opacity-40"></div>
                            <img src={`data:image/png;base64,${cutPreview}`} className="w-full h-full object-contain relative z-10" alt="扣图预览" />
                          </div>
                        )}
                      </div>
                      <Button onClick={handleGenerateImage} disabled={isUploading} className="w-full">
                        {isUploading ? '生成中…' : '生成立绘'}
                      </Button>
                   </div>
                   
                   <div className="flex-1 bg-black/50 border border-green-900 flex items-center justify-center min-h-[300px] relative bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTEgMWgydjJIMUMxeiIgZmlsbD0iIzIyMiIgZmlsbC1ydWxlPSJldmVub2RkIi8+PC9zdmc+')]">
                      {generatedImage ? (
                        <img src={`data:image/png;base64,${generatedImage}`} className="h-full object-contain" alt="生成结果" />
                      ) : (
                        <span className="text-green-900">输出预览区</span>
                      )}
                   </div>
                </div>
                <div className="text-[10px] text-green-600">
                  提示：上传真人照片会进入更严格的写实融合模式；不上传则按二次元角色生成。
                </div>
             </div>
           )}

           {/* --- AUDIO TAB --- */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
               <div>
                  <label className="block text-xs mb-1">语音输入（日语）</label>
                  <textarea className="w-full bg-black border border-green-700 p-2 text-sm h-32" value={ttsText} onChange={e => setTtsText(e.target.value)} />
                </div>
                <div className="flex items-center gap-4">
                  <Button onClick={handleTts} disabled className="w-48">语音功能已禁用</Button>
                  <span className="text-xs uppercase animate-pulse">{ttsStatus}</span>
                </div>
             </div>
           )}

           {/* --- EDGEONE TAB --- */}
          {activeTab === 'edge' && (
             <div className="space-y-4">
                <p className="text-xs text-green-400">
                  异步任务示例：直接生成并返回完整数据，不落地存储（可选轮询状态）。
                </p>
                <label className="block text-xs mb-1">请求参数</label>
                <textarea
                  className="w-full bg-black border border-green-700 p-2 text-sm h-40"
                  value={edgePayload}
                  onChange={e => setEdgePayload(e.target.value)}
                />
                <div className="flex gap-2 flex-wrap">
                  <Button onClick={handleStartEdgeTask} className="!py-2 !px-4">启动任务</Button>
                  <Button onClick={handleManualStatus} className="!py-2 !px-4" variant="secondary">单次查询</Button>
                  <Button onClick={stopEdgePolling} className="!py-2 !px-4" variant="secondary">停止轮询</Button>
                  <Button onClick={handleDownloadEdge} className="!py-2 !px-4">下载完整数据</Button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-black/60 p-3 border border-green-800">
                    <div className="text-xs text-green-500 mb-1">任务编号</div>
                    <div className="break-all">{edgeTaskId || '尚未创建'}</div>
                  </div>
                  <div className="bg-black/60 p-3 border border-green-800">
                    <div className="text-xs text-green-500 mb-1">状态</div>
                    <div className="uppercase">{formatEdgeStatus(edgeStatus)}</div>
                  </div>
                </div>
                {edgeError && (
                  <div className="bg-red-900/30 border border-red-600 text-red-200 text-xs p-3 font-mono-tech">
                    生成失败：{edgeError}
                  </div>
                )}
                <div className="text-[10px] text-green-500/70">
                  提示：当前后端为同步返回模式，任务结果仅存于内存直至下载完成，无数据库/对象存储。
                </div>
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default DevConsole;
