import { useRef } from "react";
import { Check } from "lucide-react";
import { useFocusOnMount } from "./workHooks";
import { ActionButton, WorkScreen } from "./workUi";

export default function SentScreen({ sent, onDone }) {
  const titleRef = useRef(null);
  useFocusOnMount(titleRef);

  return (
    <WorkScreen label="Sent" tone="brand">
      <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-8 text-center" role="status">
        <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-white">
          <Check className="h-11 w-11 text-[#0E7490]" strokeWidth={3} aria-hidden="true" />
        </div>
        <h1 ref={titleRef} tabIndex={-1} className="text-[26px] font-extrabold focus:outline-none">
          {sent.title}
        </h1>
        {sent.amountText && (
          <p className="tnum text-[44px] font-extrabold leading-tight tracking-[-0.03em]">{sent.amountText}</p>
        )}
        {sent.detail && <p className="text-base leading-snug text-cyan-50">{sent.detail}</p>}
        <ActionButton variant="light" onClick={onDone} className="mt-6 w-full flex-none basis-auto text-[17px] font-extrabold">
          Done
        </ActionButton>
      </div>
    </WorkScreen>
  );
}
