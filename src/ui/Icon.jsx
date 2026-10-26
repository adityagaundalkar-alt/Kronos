// Small inline icon set (24px grid, 1.7 stroke). Decorative by default; pass `label` to make one meaningful.
const P = {
  schedule: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm3 8h3m3 0h2m-8 4h3",
  dashboard: "M4 13h6V4H4v9zm0 7h6v-4H4v4zm10 0h6v-9h-6v9zm0-16v4h6V4h-6z",
  wand: "M15 4l1.2 2.3L18.5 7.5 16.2 8.7 15 11l-1.2-2.3L11.5 7.5l2.3-1.2L15 4zM5 19l9-9m-9 9l-1-1 9-9 1 1M18 14l.7 1.3L20 16l-1.3.7L18 18l-.7-1.3L16 16l1.3-.7L18 14z",
  courses: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zm0 13a3 3 0 0 1 3-3h11M9 8h6",
  assets: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 9l8-4.5M12 12L4 7.5M12 12v9",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0",
  warn: "M12 4l9 16H3L12 4zm0 6v4m0 3v.01",
  log: "M5 6h14M5 12h14M5 18h9",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2-1.2L14.6 3h-4l-.4 2.7a7.6 7.6 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7.6 7.6 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  chat: "M4 5h16v11H9l-5 4V5z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-6 9a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M17 14a5 5 0 0 1 4 6",
  share: "M15 8l-6 3.5M9 12.5l6 3.5M18 7a2.5 2.5 0 1 0 0-.01zM6 14a2.5 2.5 0 1 0 0-.01zM18 21a2.5 2.5 0 1 0 0-.01z",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  left: "M15 5l-7 7 7 7",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  right: "M9 5l7 7-7 7",
  down: "M6 9l6 6 6-6",
  up: "M6 15l6-6 6 6",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6v-9z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  download: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  copy: "M9 9h10v11H9V9zM5 15V4h10",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  trash: "M5 7h14M10 7V4h4v3m-7 0l1 13h8l1-13",
  refresh: "M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4",
  logout: "M10 5H5v14h5M15 8l4 4-4 4M19 12H9",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v5l3 2",
};
export default function Icon({ name, size = 18, label, style, className }) {
  const d = P[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0, ...style }}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path d={d} />
    </svg>
  );
}
