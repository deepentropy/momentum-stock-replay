import { BiTable, BiCog } from "react-icons/bi";

const menuItems = [
  { view: "positions", icon: BiTable, label: "Position Summary" },
  { view: "settings", icon: BiCog, label: "Settings" },
];

export default function MenuBar({ view, setView, panelOpen }) {
  return (
    <div className="flex flex-col items-center bg-[#1E222D] border-r border-[#2A2E39] py-5 w-16 z-20">
      <div className="flex flex-col gap-4">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = view === item.view && panelOpen;

          return (
            <button
              key={item.view}
              className={`
                relative flex items-center justify-center w-12 h-12 rounded-lg 
                transition-all duration-200
                ${isActive 
                  ? "bg-[#2A2E39] text-[#2962FF]" 
                  : "text-[#B2B5BE] hover:text-white hover:bg-[#2A2E39]"
                }
              `}
              title={item.label}
              onClick={() => setView(item.view)}
            >
              {isActive && (
                <div className="absolute left-[-10px] w-[3px] h-6 bg-[#2962FF] rounded-r" />
              )}
              <Icon size={24} />
            </button>
          );
        })}
      </div>
    </div>
  );
}