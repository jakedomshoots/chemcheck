import { Delete } from "lucide-react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

function keyLabel(key) {
  if (key === "back") return "Delete digit";
  if (key === ".") return "Decimal point";
  return key;
}

/** 3×4 amount keypad. Every key is a real button with a spoken label. */
export default function Keypad({ onPress, disabled = false }) {
  return (
    <div role="group" aria-label="Amount keypad" className="grid grid-cols-3 gap-0.5 px-4 pt-1">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={keyLabel(key)}
          disabled={disabled}
          onClick={() => onPress(key)}
          className="tnum flex h-[52px] items-center justify-center rounded-control text-[26px] font-semibold text-ink hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490] disabled:opacity-50"
        >
          {key === "back" ? <Delete className="h-[26px] w-[26px]" strokeWidth={2} aria-hidden="true" /> : key}
        </button>
      ))}
    </div>
  );
}
