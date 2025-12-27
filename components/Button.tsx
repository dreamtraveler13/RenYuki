'use client';

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  isLoading?: boolean;
  // isTouch removed as we want unified design language
  isTouch?: boolean; 
}

const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', isLoading, className = '', ...props }) => {
  // Industrial, Tech-feel, Sharp corners.
  // Unified padding for consistency, slightly larger touch target on mobile via padding
  const baseStyle = `
    relative overflow-hidden group 
    px-5 py-3 lg:px-8 lg:py-3 
    font-bold text-xs lg:text-sm tracking-[0.15em] uppercase 
    border border-black 
    flex items-center justify-center gap-2 
    transition-all duration-300 ease-expo
    disabled:opacity-50 disabled:cursor-not-allowed
    touch-active select-none
  `;
  
  const variants = {
    // Black background, White text -> Inverts on hover
    // On mobile, active state mimics hover
    primary: "bg-black text-white hover:bg-white hover:text-black active:bg-white active:text-black",
    
    // Transparent background, Black text -> Inverts on hover
    secondary: "bg-transparent text-black hover:bg-black hover:text-white active:bg-black active:text-white",
    
    // Red accent
    danger: "bg-red-600 text-white border-red-600 hover:bg-white hover:text-red-600 active:bg-white active:text-red-600"
  };

  return (
    <button 
      className={`${baseStyle} ${variants[variant]} ${className}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
        {/* Decoration: Tiny corner notch or line */}
        <div className="absolute top-0 right-0 w-1 h-1 bg-current opacity-20"></div>
        <div className="absolute bottom-0 left-0 w-1 h-1 bg-current opacity-20"></div>
        
        {isLoading && (
          <span className="font-mono-tech animate-pulse mr-1">[...]</span>
        )}
        <span className="relative z-10 flex items-center gap-2">
          {children}
        </span>
    </button>
  );
};

export default Button;