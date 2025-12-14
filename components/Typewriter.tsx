'use client';

import React, { useState, useEffect } from 'react';

interface TypewriterProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
}

const Typewriter: React.FC<TypewriterProps> = ({ text, speed = 30, onComplete }) => {
  const [displayLength, setDisplayLength] = useState(0);

  useEffect(() => {
    setDisplayLength(0);
    if (!text) return;

    const timer = setInterval(() => {
      setDisplayLength((prev) => {
        if (prev < text.length) {
          return prev + 1;
        } else {
          clearInterval(timer);
          if (onComplete) onComplete();
          return prev;
        }
      });
    }, speed);

    return () => clearInterval(timer);
  }, [text, speed, onComplete]);

  // Strategy: Render full text to reserve layout space (height), 
  // but make the untyped portion transparent.
  return (
    <span>
      {text.slice(0, displayLength)}
      <span className="opacity-0 select-none pointer-events-none">
        {text.slice(displayLength)}
      </span>
    </span>
  );
};

export default Typewriter;
