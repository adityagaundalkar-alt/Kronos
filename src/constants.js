// Shared constants and tiny helpers used across the app.
export const DAYS      = ["Mon","Tue","Wed","Thu","Fri"];
export const DAYS_FULL = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
export const WEEKS     = [
  { n:0,  label:"Orientation", short:"ORI" },
  ...Array.from({length:16},(_,i)=>({ n:i+1, label:`Week ${i+1}`, short:`W${i+1}` })),
];
export const DEFAULT_SLOTS = [
  { id:"am", label:"09:00 – 12:00", short:"Morning"   },
  { id:"pm", label:"13:00 – 16:00", short:"Afternoon" },
  { id:"ev", label:"17:00 – 20:00", short:"Evening"   },
];

// Session colours. `dark` is the lighter variant used on the dark theme so text stays readable.
export const PALETTE = [
  { id:"sky",     accent:"#0369a1", dark:"#5cb8ee", bg:"rgba(2,132,199,0.10)",   border:"rgba(2,132,199,0.35)"   },
  { id:"emerald", accent:"#047857", dark:"#4cd2a1", bg:"rgba(5,150,105,0.10)",   border:"rgba(5,150,105,0.35)"   },
  { id:"rose",    accent:"#be123c", dark:"#fb8da6", bg:"rgba(225,29,72,0.08)",   border:"rgba(225,29,72,0.30)"   },
  { id:"violet",  accent:"#6d28d9", dark:"#b79cfb", bg:"rgba(124,58,237,0.09)",  border:"rgba(124,58,237,0.30)"  },
  { id:"amber",   accent:"#92400e", dark:"#f0b65c", bg:"rgba(180,83,9,0.09)",    border:"rgba(180,83,9,0.30)"    },
  { id:"orange",  accent:"#b43a0a", dark:"#fb9a68", bg:"rgba(194,65,12,0.09)",   border:"rgba(194,65,12,0.30)"   },
  { id:"lime",    accent:"#3f6212", dark:"#a3d65c", bg:"rgba(77,124,15,0.09)",   border:"rgba(77,124,15,0.30)"   },
  { id:"pink",    accent:"#a21457", dark:"#f58bbd", bg:"rgba(190,24,93,0.08)",   border:"rgba(190,24,93,0.28)"   },
  { id:"cyan",    accent:"#0e6377", dark:"#56cfe8", bg:"rgba(14,116,144,0.09)",  border:"rgba(14,116,144,0.30)"  },
  { id:"slate",   accent:"#3b4658", dark:"#a9b4c8", bg:"rgba(71,85,105,0.08)",   border:"rgba(71,85,105,0.25)"   },
];
export const ROOM_TYPES = ["lecture","seminar","lab","studio","online"];
export const CATEGORIES = ["Core","Elective","Lab","Workshop","Seminar"];

export const uid = () => Math.random().toString(36).slice(2,9);
export const initials = name => String(name||"?").split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase() || "?";

/** True while the dark theme is showing (set on <html data-resolved>). */
export const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.resolved === "dark";

/** The colour set for a course, with the readable accent for the current theme. */
export function getPalette(courseId, courses) {
  const c = courses?.find(x => x.id === courseId);
  const p = PALETTE.find(x => x.id === c?.colorId) || PALETTE[0];
  return isDark() ? { ...p, accent: p.dark } : p;
}
export function paletteById(id) {
  const p = PALETTE.find(x => x.id === id) || PALETTE[0];
  return isDark() ? { ...p, accent: p.dark } : p;
}

export const USER_COLORS = ["#059669","#0284c7","#be185d","#7c3aed","#b45309","#c2410c","#0e7490","#e11d48"];
export const userColor = idx => USER_COLORS[idx % USER_COLORS.length];
