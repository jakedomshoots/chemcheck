import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A consistent back button that respects the browser history stack.
 *
 * - If there is history to go back to, it pops one entry (`navigate(-1)`).
 * - If the page was opened directly (no history), it navigates to `fallback`.
 *
 * Props:
 * - fallback: route to use when there is no previous history entry
 * - label: button text (default: "Back")
 * - variant, size, className, iconClassName: passed to the underlying Button
 * - showIcon: render the left arrow (default: true)
 * - onClick: optional extra click handler
 */
export function BackButton({
  fallback,
  label = "Back",
  variant = "ghost",
  size,
  className,
  iconClassName,
  showIcon = true,
  onClick,
  ...props
}) {
  const navigate = useNavigate();

  const handleClick = (event) => {
    onClick?.(event);

    if (window.history.length > 1) {
      navigate(-1);
    } else if (fallback) {
      navigate(fallback);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      className={cn("group", className)}
      {...props}
    >
      {showIcon && (
        <ArrowLeft
          className={cn(
            "w-4 h-4 transition-transform group-hover:-translate-x-1",
            label ? "mr-1" : "",
            iconClassName
          )}
        />
      )}
      {label}
    </Button>
  );
}
