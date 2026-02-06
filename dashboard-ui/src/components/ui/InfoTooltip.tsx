import React from 'react';
import { Info } from 'lucide-react';

export interface InfoTooltipProps {
  label: string;
  description: string;
  className?: string;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({ label, description, className }) => {
  return (
    <span className={`relative inline-flex items-center group ${className || ''}`}>
      <Info
        className="w-4 h-4 text-muted-foreground group-hover:text-foreground"
        aria-label={label}
        role="img"
        tabIndex={0}
      />
      <span className="pointer-events-none absolute z-20 left-0 top-6 max-w-[90vw] w-64 rounded-md bg-foreground text-background text-xs p-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 shadow-lg sm:left-1/2 sm:-translate-x-1/2 sm:w-56">
        <span className="font-semibold block mb-1">{label}</span>
        <span className="leading-snug">{description}</span>
      </span>
    </span>
  );
};
