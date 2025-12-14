'use client';

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  isLoading?: boolean;
  isTouch?: boolean;
}

const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', isLoading, isTouch = false, className = '', ...props }) => {
  // Helper to suppress desktop styles on touch devices
  const d = (cls: string) => isTouch ? '' : cls;

  // Sharp corners, industrial feel
  // Modified: Smaller padding and text for mobile (default), larger for lg+ (Desktop) ONLY if not touch
  const baseStyle = `px-4 py-2 ${d('lg:px-8 lg:py-3')} font-bold text-xs ${d('lg:text-sm')} tracking-widest uppercase transition-all duration-200 transform disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${d('lg:gap-3')} relative overflow-hidden group border border-black`;
  
  const variants = {
    // Black background, White text -> Inverts on hover
    primary: "bg-black text-white hover:bg-white hover:text-black",
    // Transparent background, Black text -> Inverts on hover
    secondary: "bg-transparent text-black hover:bg-black hover:text-white",
    // Red accent
    danger: "bg-red-600 text-white border-red-600 hover:bg-white hover:text-red-600"
  };

  return (
    <button 
      className={`${baseStyle} ${variants[variant]} ${className}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
        {/* Hover Effect Line */}
        <div className="absolute top-0 left-0 w-1 h-full bg-current opacity-0 group-hover:opacity-100 transition-all duration-300"></div>
        
        {isLoading && (
          <span className={`font-mono-tech animate-pulse mr-1 ${d('lg:mr-2')}`}>[...]</span>
        )}
        <span className="relative z-10 flex items-center gap-2">
          {children}
        </span>
    </button>
  );
};

export default Button;
