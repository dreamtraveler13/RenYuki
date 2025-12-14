'use client';

import React from 'react';
import { UserProfile } from '../types';

interface Props {
  onLogin: (token: string, userProfile?: UserProfile) => void;
  onEnterDevMode: () => void;
}

const LoginScreen: React.FC<Props> = ({ onLogin, onEnterDevMode }) => {
  const HAS_SYSTEM_KEY = true;

  const handleStart = () => {
    const user: UserProfile = {
      name: "玩家",
      avatarBase64: "" 
    };
    onLogin("", user);
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative bg-white overflow-hidden">
       {/* Decorative Tech Lines */}
       <div className="absolute top-0 left-0 w-full h-1 bg-black"></div>
       <div className="absolute bottom-4 right-4 md:bottom-10 md:right-10 font-mono-tech text-[10px] md:text-xs text-gray-400 rotate-90 origin-right">
          系统版本 2.0.4
       </div>

       <div className="z-10 text-center space-y-6 md:space-y-12 p-4 md:p-8 animate-glitch relative max-w-4xl w-full">
          {/* Main Title Block */}
          <div className="relative border-l-4 border-black pl-4 md:pl-8 text-left">
            <h1 className="text-5xl md:text-9xl font-black text-black tracking-tighter leading-none">
              RenYuki
            </h1>
            <p className="text-lg md:text-5xl font-light text-gray-400 tracking-[0.2em] uppercase mt-0 md:mt-[-10px]">
              意淫你的嘎拉
            </p>
            
            <div className="hidden md:block absolute -right-20 top-0 text-xs font-mono-tech bg-black text-white px-2 py-1">
               项目：RenYuki
            </div>
          </div>

          <div className="pt-4 md:pt-10 flex flex-col items-center gap-4">
            {HAS_SYSTEM_KEY ? (
               <button 
                 onClick={handleStart}
                 className="group relative px-8 py-3 md:px-16 md:py-5 text-sm md:text-xl font-bold bg-black text-white hover:bg-white hover:text-black border-2 border-black transition-all duration-300"
               >
                 <span className="absolute top-1 left-1 w-2 h-2 bg-white group-hover:bg-black"></span>
                 <span className="absolute bottom-1 right-1 w-2 h-2 bg-white group-hover:bg-black"></span>
                 开始
               </button>
            ) : (
               <div className="border border-red-500 text-red-500 px-4 py-2 md:px-6 md:py-4 font-mono-tech text-xs md:text-sm">
                 错误：缺少 API_KEY
               </div>
            )}
            
            <p className="text-gray-400 text-[10px] md:text-xs font-mono-tech tracking-widest mt-4 md:mt-8">
               AI 生成式嘎拉
            </p>

            {/* DEV MODE TOGGLE */}
            {HAS_SYSTEM_KEY && (
               <button 
                 onClick={onEnterDevMode}
                 className="absolute bottom-[-60px] opacity-50 hover:opacity-100 text-[10px] font-mono-tech border border-gray-300 px-2 py-1"
               >
                  进入开发者控制台
               </button>
            )}
          </div>
       </div>
    </div>
  );
};

export default LoginScreen;
