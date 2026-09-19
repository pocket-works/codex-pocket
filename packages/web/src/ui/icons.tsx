// Small line icons (24px grid, currentColor) so the UI does not depend on
// emoji rendering. Paths follow the Lucide set.
function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const FolderIcon = () => <Icon d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />;
export const ClockIcon = () => <Icon d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.7 2.7L3 8M3 3v5h5M12 7v5l4 2" />;
export const ArchiveIcon = () => <Icon d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />;
export const SettingsIcon = () => <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />;
export const RefreshIcon = () => <Icon d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />;
export const ComposeIcon = ({ size = 22 }: { size?: number }) => <Icon size={size} d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />;
export const SearchIcon = () => <Icon d="M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" />;
export const MenuIcon = () => <Icon d="M4 7h16M4 12h10M4 17h16" />;
export const CheckIcon = () => <Icon size={18} d="M20 6 9 17l-5-5" />;
export const BranchIcon = ({ size = 22 }: { size?: number }) => <Icon size={size} d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" />;
export const MonitorIcon = () => <Icon d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 21h8M12 17v4" />;
export const ShieldIcon = () => <Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
export const SlidersIcon = () => <Icon d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />;
export const ChatIcon = () => <Icon d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.8 8.8 0 0 1-3.6-.8L3 21l1.9-4.6A8.4 8.4 0 1 1 21 11.5z" />;
export const LaptopIcon = () => <Icon d="M4 5h16a1 1 0 0 1 1 1v9H3V6a1 1 0 0 1 1-1zM2 18h20l-1 2H3z" />;
export const WorktreeIcon = () => <Icon d="M4 7h6l4 5h6M4 17h6l4-5M17 9l3 3-3 3" />;
export const ChevronsIcon = () => <Icon size={14} d="m7 9 5-5 5 5M7 15l5 5 5-5" />;
export const ChevronIcon = () => <Icon size={18} d="m9 6 6 6-6 6" />;
