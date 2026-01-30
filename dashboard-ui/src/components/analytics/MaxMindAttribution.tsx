export function MaxMindAttribution() {
  return (
    <div className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
      This product includes GeoLite2 data created by MaxMind, available from{' '}
      <a
        href="https://www.maxmind.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
      >
        https://www.maxmind.com
      </a>
    </div>
  );
}
