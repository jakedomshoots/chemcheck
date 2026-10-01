/**
 * SkipToContent — the first focusable element on a page. Visually hidden
 * until it receives keyboard focus (see `.skip-link` in index.css), then it
 * jumps past the app chrome to the page's main landmark.
 *
 * Pages give their `<main>` an `id="main-content"` and render this at the top.
 */
export default function SkipToContent({ targetId = "main-content", label = "Skip to content" }) {
  const handleClick = (event) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: false });
    try {
      target.scrollIntoView({ block: "start" });
    } catch {
      /* jsdom or very old engines */
    }
  };

  return (
    <a href={`#${targetId}`} className="skip-link" onClick={handleClick}>
      {label}
    </a>
  );
}
