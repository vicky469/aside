export const ASIDE_ICON_ID = "aside";
export const ASIDE_REGENERATE_ICON_ID = "aside-regenerate";

// Obsidian addIcon() expects children that fit a 0 0 100 100 view box, not a full 24x24 <svg>.
export const ASIDE_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(4.1666666667)">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  <path d="M8.5 10h.01"></path>
  <path d="M12 10h.01"></path>
  <path d="M15.5 10h.01"></path>
</g>`;

export const ASIDE_REGENERATE_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
  <path d="M25 37a30 30 0 0 1 49-10"></path>
  <path d="M75 13v19H56"></path>
  <path d="M75 63a30 30 0 0 1-49 10"></path>
  <path d="M25 87V68h19"></path>
</g>`;
