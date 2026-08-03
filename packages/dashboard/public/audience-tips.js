/** Audience tips — shown on the live stream canvas as prismatic toasts. */

export const AUDIENCE_TIPS = [
  {
    label: "Request music",
    text: 'Type a genre in chat — try "play jazz" or "more synthwave next"',
  },
  {
    label: "You pick the vibe",
    text: "DJ Monkey reads chat and chooses what style plays next",
  },
  {
    label: "Get a shoutout",
    text: "Request a genre in chat and DJ Monkey may call you out on air",
  },
  {
    label: "Always on",
    text: "24/7 live instrumental beats — no talk-over during songs",
  },
  {
    label: "How to request",
    text: 'Say "funk next please", "play ambient", or "more lofi"',
  },
  {
    label: "Chat drives the mood",
    text: "Active chat helps DJ Monkey pick the next vibe",
  },
  {
    label: "Study & focus",
    text: "Background music for studying, coding, working, or relaxing",
  },
  {
    label: "Name a vibe",
    text: "Any style in the library works — jazz, ambient, rock, synthwave…",
  },
  {
    label: "Stay awhile",
    text: "The stream never stops — leave it on in the background",
  },
];

/**
 * @param {HTMLElement | null} root Toast element (.tip-toast)
 * @param {{ intervalMs?: number, displayMs?: number, tips?: typeof AUDIENCE_TIPS }} [options]
 * @returns {{ stop: () => void, showNext: () => void }}
 */
export function startAudienceTipToasts(root, options = {}) {
  const tips = options.tips ?? AUDIENCE_TIPS;
  const intervalMs = options.intervalMs ?? 60_000;
  const displayMs = options.displayMs ?? 8_000;

  if (!root || tips.length === 0) {
    return { stop: () => {}, showNext: () => {} };
  }

  const labelEl = root.querySelector("[data-tip-label]");
  const textEl = root.querySelector("[data-tip-text]");

  let lastIndex = -1;
  let hideTimer = null;
  let intervalId = null;
  let stopped = false;

  function pickIndex() {
    if (tips.length === 1) return 0;
    let index;
    do {
      index = Math.floor(Math.random() * tips.length);
    } while (index === lastIndex);
    return index;
  }

  function hide() {
    root.classList.remove("is-visible");
    window.setTimeout(() => {
      if (!root.classList.contains("is-visible")) {
        root.hidden = true;
      }
    }, 420);
  }

  function showTip(index) {
    const tip = tips[index];
    if (!tip) return;

    lastIndex = index;
    if (labelEl) labelEl.textContent = tip.label;
    if (textEl) textEl.textContent = tip.text;

    root.hidden = false;
    requestAnimationFrame(() => {
      root.classList.add("is-visible");
    });

    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, displayMs);
  }

  function showNext() {
    if (stopped) return;
    showTip(pickIndex());
  }

  intervalId = window.setInterval(showNext, intervalMs);

  return {
    stop() {
      stopped = true;
      if (intervalId) clearInterval(intervalId);
      if (hideTimer) clearTimeout(hideTimer);
      hide();
    },
    showNext,
  };
}
