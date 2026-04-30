import { Bot, FileText, MessageSquare, Settings, type LucideIcon } from "lucide-react";
import type { ActivityId } from "../types";

interface ActivityItem {
  id: ActivityId;
  label: string;
  icon: LucideIcon;
}

const activities: ActivityItem[] = [
  { id: "paper", label: "Paper", icon: FileText },
  { id: "ai", label: "AI", icon: Bot },
  { id: "settings", label: "Settings", icon: Settings },
];

interface ActivityBarProps {
  activeActivity: ActivityId;
  isChatOpen: boolean;
  onChange: (activity: ActivityId) => void;
  onToggleChat: () => void;
}

export function ActivityBar({
  activeActivity,
  isChatOpen,
  onChange,
  onToggleChat,
}: ActivityBarProps) {
  return (
    <nav className="activityBar" aria-label="PaperSuper">
      <div className="activityMark">PS</div>
      <button
        type="button"
        className={`activityButton ${isChatOpen ? "active" : ""}`}
        title={isChatOpen ? "Hide AI Chat" : "Show AI Chat"}
        aria-label={isChatOpen ? "Hide AI Chat" : "Show AI Chat"}
        aria-pressed={isChatOpen}
        onClick={onToggleChat}
      >
        <MessageSquare size={17} strokeWidth={1.9} />
      </button>
      <div className="activityButtons">
        {activities.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={`activityButton ${activeActivity === id ? "active" : ""}`}
            title={label}
            aria-label={label}
            onClick={() => onChange(id)}
          >
            <Icon size={17} strokeWidth={1.9} />
          </button>
        ))}
      </div>
    </nav>
  );
}
