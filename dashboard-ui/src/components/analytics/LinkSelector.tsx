export interface IssueLink {
  id: string;
  url: string;
  title?: string;
  totalClicks: number;
}

export interface LinkSelectorProps {
  links: IssueLink[];
  selectedLinkId: string | null;
  onLinkSelect: (linkId: string | null) => void;
}

export function LinkSelector({
  links,
  selectedLinkId,
  onLinkSelect
}: LinkSelectorProps) {
  const totalClicks = links.reduce((sum, link) => sum + link.totalClicks, 0);

  return (
    <div className="mb-4">
      <h3 className="text-sm font-medium text-gray-700 mb-2">Filter by Link</h3>
      <div className="max-h-48 overflow-y-auto space-y-1">
        <button
          onClick={() => onLinkSelect(null)}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            selectedLinkId === null
              ? 'bg-blue-100 text-blue-900 font-medium'
              : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
          }`}
        >
          <div className="flex justify-between items-center">
            <span>All Links</span>
            <span className="text-xs text-gray-500">{totalClicks.toLocaleString()} clicks</span>
          </div>
        </button>

        {links.map(link => (
          <button
            key={link.id}
            onClick={() => onLinkSelect(link.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              selectedLinkId === link.id
                ? 'bg-blue-100 text-blue-900 font-medium'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <div className="flex justify-between items-center gap-2">
              <span className="truncate">{link.title || link.url}</span>
              <span className="text-xs text-gray-500 flex-shrink-0">
                {link.totalClicks.toLocaleString()} clicks
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
