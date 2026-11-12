"use client";

/** A short burst of confetti for a right answer or a finished goal. */
export async function celebrate(big = false) {
  const { default: confetti } = await import("canvas-confetti");
  confetti({
    particleCount: big ? 160 : 70,
    spread: big ? 100 : 65,
    startVelocity: big ? 45 : 32,
    origin: { y: 0.7 },
    colors: ["#cc785c", "#e8a55a", "#5db8a6", "#efe9de", "#141413"],
    disableForReducedMotion: true,
  });
}
