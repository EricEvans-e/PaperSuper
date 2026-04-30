import { Bot, FileText, Settings, type LucideIcon } from "lucide-react";
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
  onChange: (activity: ActivityId) => void;
}

export function ActivityBar({
  activeActivity,
  onChange,
}: ActivityBarProps) {
  return (
    <nav className="activityBar" aria-label="PaperSuper">
      <div className="activityMark">PS</div>
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
