/**
 * Scroll reveal with a guarantee: content is never left invisible.
 *
 * A `gsap.from({opacity: 0})` or a `strokeDashoffset` draw-on hides real
 * content and depends on a scroll trigger to bring it back. When that trigger
 * does not fire — a stitched full-page screenshot, a crawler that never
 * scrolls, an IntersectionObserver that misses because the element was resized
 * under it — the content stays hidden forever and nothing reports an error.
 * That is a silent failure, and the pipeline contract does not allow one.
 *
 * So: the element is visible by default in the markup, JS opts it into the
 * hidden state, and a hard deadline reveals it regardless of whether the
 * observer ever fired. The animation is an enhancement on top of content that
 * is already correct.
 */

const FAILSAFE_MS = 1600;

export function revealWhenVisible(
  target: Element,
  onReveal: () => void,
  { threshold = 0.2 }: { threshold?: number } = {},
): () => void {
  let done = false;

  const fire = () => {
    if (done) return;
    done = true;
    onReveal();
  };

  const io = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        fire();
        io.disconnect();
      }
    },
    { threshold },
  );
  io.observe(target);

  // The guarantee. If the observer has not fired by now, reveal anyway.
  const timer = setTimeout(() => {
    fire();
    io.disconnect();
  }, FAILSAFE_MS);

  return () => {
    clearTimeout(timer);
    io.disconnect();
  };
}
