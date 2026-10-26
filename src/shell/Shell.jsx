import { Modal, Btn, Avatar } from "../ui/kit.jsx";
import Icon from "../ui/Icon.jsx";

/** All views. `need`: "edit" views are hidden from read-only viewers; "room" views only show inside a shared room. */
export const VIEWS = [
  { id: "schedule",     icon: "schedule",  label: "Schedule",      group: "plan" },
  { id: "dashboard",    icon: "dashboard", label: "Overview",      group: "plan" },
  { id: "autoschedule", icon: "wand",      label: "Auto-schedule", group: "plan", need: "edit", sub: "Find clash-free times for whole courses at once" },
  { id: "courses",      icon: "courses",   label: "Courses",       group: "data", need: "edit" },
  { id: "assets",       icon: "assets",    label: "Instructors & rooms", group: "data", need: "edit", title: "Instructors, rooms and groups" },
  { id: "instructor",   icon: "person",    label: "By instructor", group: "data", sub: "One person's week at a glance" },
  { id: "conflicts",    icon: "warn",      label: "Conflicts",     group: "review" },
  { id: "comments",     icon: "chat",      label: "Comments",      group: "review", need: "room", sub: "Questions and feedback on sessions" },
  { id: "activity",     icon: "activity",  label: "Live activity", group: "review", need: "room" },
  { id: "changelog",    icon: "log",       label: "History",       group: "review", need: "edit", sub: "What changed, and when" },
  { id: "settings",     icon: "settings",  label: "Settings",      group: "review", need: "edit" },
];
export const visibleViews = ({ canEdit, inRoom }) => VIEWS.filter(v => (v.need !== "edit" || canEdit) && (v.need !== "room" || inRoom));
export const MOBILE_PRIMARY = ["schedule", "conflicts", "comments", "instructor"];

function Badge({ n }) { return n > 0 ? <span className="count">{n}</span> : null; }

export function Rail({ views, view, onView, counts, theme, onToggleTheme, user, onSignIn, onSignOut, signedInHint }) {
  const groups = ["plan", "data", "review"];
  return (
    <aside className="rail" aria-label="Main">
      <div className="brand"><span className="brand-mark" aria-hidden="true">K</span><span className="brand-name">Kronos<small>2.0</small></span></div>
      <nav className="nav" aria-label="Views">
        {groups.map((g, gi) => {
          const items = views.filter(v => v.group === g);
          if (!items.length) return null;
          return (
            <div key={g} style={{ display: "contents" }}>
              {gi > 0 && <div className="nav-sep" role="separator" />}
              {items.map(v => (
                <button key={v.id} type="button" className="nav-item" aria-current={view === v.id ? "page" : undefined} onClick={() => onView(v.id)} title={v.label}>
                  <Icon name={v.icon} size={19} /><span className="label">{v.label}</span>
                  <Badge n={counts[v.id]} />
                </button>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="rail-foot">
        <button type="button" className="nav-item" onClick={onToggleTheme} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={19} /><span className="label">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
        </button>
        {user ? (
          <>
            <div className="who"><Avatar name={user.displayName || user.email} src={user.photoURL} size={28} /><span className="name">{user.displayName || user.email}</span></div>
            <button type="button" className="nav-item" onClick={onSignOut} title="Sign out"><Icon name="logout" size={19} /><span className="label">Sign out</span></button>
          </>
        ) : (
          <button type="button" className="nav-item" onClick={onSignIn} title={signedInHint}><Icon name="person" size={19} /><span className="label">Sign in to save</span></button>
        )}
      </div>
    </aside>
  );
}

export function TabBar({ views, view, onView, counts, onMore }) {
  const primary = MOBILE_PRIMARY.map(id => views.find(v => v.id === id)).filter(Boolean);
  const moreActive = !primary.some(v => v.id === view);
  return (
    <nav className="tabbar" aria-label="Views">
      {primary.map(v => (
        <button key={v.id} type="button" aria-current={view === v.id ? "page" : undefined} onClick={() => onView(v.id)}>
          <Icon name={v.icon} size={21} /><span>{v.label.replace("By instructor", "Instructors")}</span>
          <Badge n={counts[v.id]} />
        </button>
      ))}
      <button type="button" aria-current={moreActive ? "page" : undefined} onClick={onMore}><Icon name="more" size={21} /><span>More</span></button>
    </nav>
  );
}

export function MoreSheet({ views, view, onView, onClose, theme, onToggleTheme, user, onSignIn, onSignOut }) {
  return (
    <Modal title="Menu" onClose={onClose} width={420}>
      <div style={{ padding: 8 }}>
        {views.map(v => (
          <button key={v.id} type="button" onClick={() => { onView(v.id); onClose(); }} aria-current={view === v.id ? "page" : undefined}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 12px", borderRadius: "var(--r)", fontSize: 16, fontWeight: 500, textAlign: "left", background: view === v.id ? "var(--accent-soft)" : "transparent" }}>
            <Icon name={v.icon} size={20} />{v.label}
          </button>
        ))}
        <div style={{ height: 1, background: "var(--border)", margin: "8px 4px" }} />
        <button type="button" onClick={onToggleTheme} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 12px", fontSize: 16, fontWeight: 500, textAlign: "left" }}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />{theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
        {user
          ? <button type="button" onClick={() => { onSignOut(); onClose(); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 12px", fontSize: 16, fontWeight: 500, textAlign: "left" }}><Icon name="logout" size={20} />Sign out ({user.displayName || user.email})</button>
          : <button type="button" onClick={() => { onSignIn(); onClose(); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 12px", fontSize: 16, fontWeight: 500, textAlign: "left" }}><Icon name="person" size={20} />Sign in to save</button>}
      </div>
    </Modal>
  );
}
