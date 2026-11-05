"use client";

import { driver } from "driver.js";

/** A short guided tour of the study view. Targets elements marked with data-tour. */
export function startTour() {
  // Only point at things that are on screen right now (the toolbar is hidden outside Explore).
  const has = (sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest('[data-hidden="true"]');
  };
  const steps = [
    {
      element: '[data-tour="viewer"]',
      popover: { title: "This is your machine", description: "Grab the machine to move it, drag the background to turn it any way, and scroll to zoom where you point. Tap a part to find out what it does; double-click to look closer." },
    },
    {
      element: '[data-tour="apart"]',
      popover: { title: "Take it apart", description: "Slide this to pull every part away from the others, so you can see what's inside." },
    },
    {
      element: '[data-tour="parts"]',
      popover: { title: "All the parts", description: "Every part has a name. Tap one to learn about it. Parts you've looked at get a green tick." },
    },
    {
      element: '[data-tour="modes"]',
      popover: { title: "More ways to learn", description: "Take it apart step by step, look at drawings, or test yourself with a quiz." },
    },
    {
      element: '[data-tour="info"]',
      popover: { title: "Start here", description: "Read or listen to how the whole machine works, then try the buttons." },
    },
  ].filter((s) => has(s.element));
  driver({ showProgress: true, popoverClass: "cutaway-tour", nextBtnText: "Next", prevBtnText: "Back", doneBtnText: "Let's go!", steps }).drive();
}
