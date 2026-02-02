export interface AttributionProps {
  className?: string;
}

export function Attribution({ className = '' }: AttributionProps) {
  return (
    <div className={`text-xs text-gray-500 mt-2 ${className}`}>
      This product includes GeoLite2 data created by MaxMind, available from{' '}
      <a
        href="https://www.maxmind.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline"
      >
        https://www.maxmind.com
      </a>
    </div>
  );
}
