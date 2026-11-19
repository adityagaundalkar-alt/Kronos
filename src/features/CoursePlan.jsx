// Course plan: the courses running this term, whether each (or each section) has all its lectures, where the missing
// ones could go, and whether the pace through the term is even.
import { useMemo, useState } from "react";
import { buildPlan, suggestPlacements, planStarted, sessionLabel, outOfOrder, renumber, numberKey, sessionAt, unitDefaults, DEFAULT_TARGET } from "../plan.js";
import { DAYS, WEEKS, getPalette, uid } from "../constants.js";
import { Btn, Segmented, EmptyState } from "../ui/kit.jsx";
import Icon from "../ui/Icon.jsx";

const muted = { color: "var(--muted)", fontSize: 13.5 };
const card = { background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r2)" };
const weekShort = n => WEEKS.find(w => w.n === n)?.short || `W${n}`;
const weeksText = ws => {
  // 3,4,5,9 -> W3–W5, W9
  const out = []; let i = 0;
  while (i < ws.length) { let j = i; while (j + 1 < ws.length && ws[j + 1] === ws[j] + 1) j++; out.push(j > i ? `W${ws[i]}–W${ws[j]}` : `W${ws[i]}`); i = j + 1; }
  return out.join(", ");
};

export default function CoursePlan({ state, setState, canEdit, toast, onApptClick }) {
  const plan = useMemo(() => buildPlan(state), [state]);
  const started = planStarted(state.courses);
  const [choosing, setChoosing] = useState(!started && canEdit);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const stale = useMemo(() => outOfOrder(state.appointments, state.slots), [state.appointments, state.slots]);

  const rows = plan.rows;
  const short = rows.filter(r => r.missing > 0), done = rows.filter(r => r.missing === 0 && r.over === 0), over = rows.filter(r => r.over > 0);
  const paceRows = rows.filter(r => r.pace.issues > 0);
  const missingTotal = short.reduce((n, r) => n + r.missing, 0);
  const ql = q.trim().toLowerCase();
  const shown = rows.filter(r => (filter === "all" || (filter === "short" && r.missing > 0) || (filter === "done" && r.missing === 0 && r.over === 0) || (filter === "over" && r.over > 0) || (filter === "pace" && r.pace.issues > 0))
    && (!ql || `${r.course.code} ${r.course.name} ${r.section?.name || ""}`.toLowerCase().includes(ql)));

  const setCourse = (id, patch, op, detail) => setState(s => ({ ...s, courses: s.courses.map(c => c.id === id ? { ...c, ...patch } : c) }), op, detail);
  const setSectionTarget = (course, sid, target) => setCourse(course.id, { sections: course.sections.map(x => x.id === sid ? { ...x, target: target || undefined } : x) }, "changed lecture target", course.code);
  function addSessions(list, what) {
    if (!list.length) return;
    setState(s => ({
      ...s,
      appointments: { ...s.appointments, ...Object.fromEntries(list.map(a => [a.id, a])) },
      changelog: [...(s.changelog || []).slice(-199), { at: Date.now(), action: "Lectures added", detail: what }],
    }), "added lectures", what);
    toast(`Added ${list.length} lecture${list.length === 1 ? "" : "s"} for ${what}. You can undo it.`, "ok");
  }

  return (
    <div style={{ padding: 16, overflowY: "auto", minHeight: 0, height: "100%", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <p style={{ ...muted, fontSize: 14.5, lineHeight: 1.5, maxWidth: 720, margin: 0 }}>
          The courses running this term and whether each has all its lectures. Each section counts on its own; extra classes are counted separately.
        </p>
      </div>

      {!started && (
        <div className="callout info">
          Choose which courses run this term. Until you do, every course is listed{canEdit ? " and offered when scheduling" : ""}.
        </div>
      )}
      {plan.stray.length > 0 && (
        <div className="callout warn" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 240 }}>
            {plan.stray.length} course{plan.stray.length === 1 ? " is" : "s are"} scheduled but not running this term: {plan.stray.slice(0, 4).map(x => `${x.course.code} (${x.count})`).join(", ")}{plan.stray.length > 4 ? ` and ${plan.stray.length - 4} more` : ""}.
          </span>
          {canEdit && <Btn variant="outline" onClick={() => setState(s => ({ ...s, courses: s.courses.map(c => plan.stray.some(x => x.course.id === c.id) ? { ...c, running: true } : c) }), "chose running courses", plan.stray.map(x => x.course.code).join(", "))}>Add them to the plan</Btn>}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="pill">{new Set(rows.map(r => r.course.id)).size} course{new Set(rows.map(r => r.course.id)).size === 1 ? "" : "s"} running</span>
        <span className="pill ok">{done.length} complete</span>
        {short.length > 0 && <span className="pill bad">{short.length} short · {missingTotal} lecture{missingTotal === 1 ? "" : "s"} missing</span>}
        {over.length > 0 && <span className="pill warn">{over.length} over target</span>}
        {paceRows.length > 0 && <span className="pill warn">{paceRows.length} with pace issues</span>}
        <span style={{ flex: 1 }} />
        {canEdit && <Btn variant={choosing ? "primary" : "outline"} onClick={() => setChoosing(v => !v)}>{choosing ? "Done choosing" : "Choose courses"}</Btn>}
      </div>

      {choosing && canEdit && <CoursePicker courses={state.courses} setCourse={setCourse} setState={setState} />}

      {rows.length === 0 ? (
        <EmptyState title="No courses yet">Add courses in the Courses tab, then choose which run this term.</EmptyState>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Segmented label="Show" value={filter} onChange={setFilter} options={[
              { value: "all", label: `All (${rows.length})` }, { value: "short", label: `Short (${short.length})` },
              { value: "done", label: `Complete (${done.length})` }, { value: "over", label: `Over (${over.length})` },
              { value: "pace", label: `Pace (${paceRows.length})` },
            ]} />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search courses" aria-label="Search courses" style={{ flex: "1 1 200px", maxWidth: 320 }} />
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map(r => (
              <PlanRow key={r.key} row={r} state={state} canEdit={canEdit} open={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)}
                stale={r.lectures.length > 0 && stale.has(numberKey(r.lectures[0]))}
                onRenumber={() => setState(s => renumber(s, new Set([numberKey(r.lectures[0])])), "renumbered sessions", r.course.code)}
                onTarget={t => r.section ? setSectionTarget(r.course, r.section.id, t) : setCourse(r.course.id, { targetSessions: t || undefined }, "changed lecture target", r.course.code)}
                onAdd={addSessions} onApptClick={onApptClick} />
            ))}
            {shown.length === 0 && <li style={muted}>Nothing matches.</li>}
          </ul>
        </>
      )}
    </div>
    </div>
  );
}

function CoursePicker({ courses, setCourse, setState }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const list = courses.filter(c => !ql || `${c.code} ${c.name}`.toLowerCase().includes(ql));
  const setAll = v => setState(s => ({ ...s, courses: s.courses.map(c => list.some(x => x.id === c.id) ? { ...c, running: v } : c) }), "chose running courses", v ? "all" : "none");
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <strong style={{ fontSize: 15 }}>Courses running this term</strong>
        <span style={{ flex: 1 }} />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search courses to choose" style={{ width: 200 }} />
        <Btn variant="ghost" onClick={() => setAll(true)}>Select {ql ? "these" : "all"}</Btn>
        <Btn variant="ghost" onClick={() => setAll(false)}>Clear {ql ? "these" : "all"}</Btn>
      </div>
      <div style={{ ...muted, marginBottom: 8 }}>Lectures needed is per section for courses with sections. Leave it empty for {DEFAULT_TARGET}.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 6, maxHeight: 360, overflowY: "auto" }}>
        {list.map(c => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--r)", background: c.running ? "var(--accent-soft)" : "transparent" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, cursor: "pointer" }}>
              <input type="checkbox" checked={!!c.running} onChange={e => setCourse(c.id, { running: e.target.checked }, "chose running courses", c.code)} />
              <span style={{ font: "600 13px var(--mono)", whiteSpace: "nowrap", flexShrink: 0 }}>{c.code}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
            </label>
            <input type="number" min="1" max="60" value={c.targetSessions || ""} placeholder={String(DEFAULT_TARGET)} aria-label={`Lectures needed for ${c.code}`} title="Lectures needed"
              onChange={e => setCourse(c.id, { targetSessions: parseInt(e.target.value, 10) || undefined }, "changed lecture target", c.code)} style={{ width: 64 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanRow({ row, state, canEdit, open, onToggle, stale, onRenumber, onTarget, onAdd, onApptClick }) {
  const { course, section, lectures, extras, target, missing, over, pace } = row;
  const pal = getPalette(course.id, state.courses);
  const instrId = section?.instructorId || course.defaultInstructorId;
  const instr = state.instructors.find(i => i.id === instrId);
  const pct = Math.min(100, Math.round((lectures.length / target) * 100));
  const title = `${course.code}${section ? ` §${section.name}` : row.noSection ? " (no section)" : ""}`;
  const status = row.noSection ? <span className="pill warn">Needs a section</span> : missing > 0 ? <span className="pill bad">{missing} missing</span> : over > 0 ? <span className="pill warn">{over} over</span> : <span className="pill ok"><Icon name="check" size={12} /> Complete</span>;
  return (
    <li style={{ ...card, borderLeft: `4px solid ${pal.accent}` }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 14px", textAlign: "left", font: "inherit", color: "inherit", flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 240px", minWidth: 0 }}>
          <span style={{ font: "600 14px var(--mono)", color: pal.accent }}>{title}</span>
          <span style={{ fontWeight: 600, marginLeft: 8 }}>{course.name}</span>
          <span style={{ display: "block", ...muted }}>{instr ? instr.name : "No instructor set"}</span>
        </span>
        <span style={{ flex: "0 0 220px" }}>
          <span style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
            <span><b>{lectures.length}</b> of {target} lectures</span>
            {extras.length > 0 && <span style={{ color: "var(--muted)" }}>+{extras.length} extra</span>}
          </span>
          <span aria-hidden="true" style={{ display: "block", height: 6, borderRadius: 99, background: "var(--bg4)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${pct}%`, background: missing > 0 ? "var(--danger)" : over > 0 ? "var(--signal)" : "var(--ok)" }} />
          </span>
        </span>
        <span style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end", flex: "0 0 190px" }}>
          {status}
          {pace.issues > 0 && <span className="pill warn" title="Gaps, crowded weeks or lectures on holidays">Pace</span>}
          <Icon name={open ? "up" : "down"} size={16} style={{ color: "var(--muted)" }} />
        </span>
      </button>
      {open && <RowDetails row={row} state={state} canEdit={canEdit} stale={stale} onRenumber={onRenumber} onTarget={onTarget} onAdd={onAdd} onApptClick={onApptClick} title={title} />}
    </li>
  );
}

function RowDetails({ row, state, canEdit, stale, onRenumber, onTarget, onAdd, onApptClick, title }) {
  const { lectures, extras, missing, pace, section, course } = row;
  const [showAll, setShowAll] = useState(false);
  const sugg = useMemo(() => (missing > 0 && !row.noSection ? suggestPlacements(state, row, { makeId: uid }) : null), [state, row, missing]);
  const slotShort = id => state.slots.find(s => s.id === id)?.short || id;
  const roomList = o => (o.rooms.length ? o.rooms.slice(0, 2).join(", ") + (o.rooms.length > 2 ? ` +${o.rooms.length - 2}` : "") : "no room");
  const chip = a => (
    <button key={a.id} type="button" onClick={() => onApptClick?.(a)} className="pill" title="Open session" style={{ cursor: "pointer" }}>
      <b style={{ fontFamily: "var(--mono)" }}>{sessionLabel(a) || "–"}</b> {weekShort(a.weekNum)} {DAYS[a.dayIdx]} {slotShort(a.timeId)}
    </button>
  );
  const sub = { fontWeight: 700, fontSize: 14, margin: "14px 0 6px" };
  const weeks = sugg ? (showAll ? sugg.perWeek : sugg.perWeek.slice(0, 6)) : [];
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "4px 14px 14px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          Lectures needed{section ? " for this section" : ""}
          <input type="number" min="1" max="60" disabled={!canEdit} value={(section ? section.target : course.targetSessions) || ""} placeholder={String(section ? (course.targetSessions || DEFAULT_TARGET) : DEFAULT_TARGET)}
            onChange={e => onTarget(parseInt(e.target.value, 10) || 0)} style={{ width: 70 }} aria-label="Lectures needed" />
        </label>
        {stale && canEdit && <><span className="pill warn">Numbers not in date order</span><Btn variant="outline" onClick={onRenumber}>Renumber by date</Btn></>}
      </div>

      <div style={sub}>Lectures</div>
      {lectures.length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{lectures.map(chip)}</div> : <div style={muted}>None scheduled yet.</div>}
      {extras.length > 0 && (<><div style={sub}>Extra classes</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{extras.map(chip)}</div></>)}

      {pace.issues > 0 && (
        <>
          <div style={sub}>Pace</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
            {pace.gaps.length > 0 && <li>No lecture in {weeksText(pace.gaps)}.</li>}
            {pace.crowded.map(c => <li key={c.weekNum}>{c.count} lectures in {weekShort(c.weekNum)}.</li>)}
            {pace.onHoliday.map(({ a, name }) => <li key={a.id}>{sessionLabel(a) || "A lecture"} is on {name} ({weekShort(a.weekNum)} {DAYS[a.dayIdx]}).</li>)}
          </ul>
        </>
      )}

      {row.noSection && missing > 0 && <div className="callout info" style={{ marginTop: 12 }}>These sessions have no section. Give them one in the session editor; suggestions are made per section.</div>}
      {sugg && (
        <>
          <div style={{ ...sub, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ flex: 1 }}>Where the {missing} missing lecture{missing === 1 ? "" : "s"} could go</span>
            {canEdit && sugg.fill.length > 0 && <Btn variant="primary" onClick={() => onAdd(sugg.fill, title)}>Add {sugg.fill.length} lecture{sugg.fill.length === 1 ? "" : "s"}</Btn>}
          </div>
          <div style={{ ...muted, marginBottom: 8 }}>
            Times when the instructor, the student groups and a room are all free, in weeks without a lecture. {sugg.fill.length > 0 ? `"Add" uses the first ${sugg.fill.length} week${sugg.fill.length === 1 ? "" : "s"}, at the usual time where it's free.` : ""}
          </div>
          {sugg.short > 0 && (
            <div className="callout warn" style={{ marginBottom: 8 }}>
              {sugg.perWeek.length ? `Only ${sugg.perWeek.length} week${sugg.perWeek.length === 1 ? " has" : "s have"} a free time, so ${sugg.short} lecture${sugg.short === 1 ? "" : "s"} can't be placed.` : "No week has a free time."} Try a second lecture in a week that has one, another instructor or room, or an extra time slot.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {weeks.map(w => (
              <div key={w.weekNum} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ width: 44, font: "600 13px var(--mono)", color: "var(--muted)" }}>{weekShort(w.weekNum)}</span>
                {w.options.slice(0, 4).map(o => (
                  <span key={`${o.dayIdx}_${o.timeId}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border2)", borderRadius: 99, padding: "2px 4px 2px 10px", fontSize: 13 }}>
                    {DAYS[o.dayIdx]} {slotShort(o.timeId)}{o.usual ? " (usual)" : ""} · {roomList(o)}{o.load ? ` · ${o.load} other` : ""}
                    {canEdit && <Btn variant="ghost" size="xs" onClick={() => onAdd([suggestionToSession(row, o)], title)} title="Add a lecture here">Add</Btn>}
                  </span>
                ))}
                {w.options.length > 4 && <span style={muted}>+{w.options.length - 4} more</span>}
              </div>
            ))}
          </div>
          {sugg.perWeek.length > 6 && <Btn variant="ghost" onClick={() => setShowAll(v => !v)} style={{ marginTop: 6 }}>{showAll ? "Show fewer weeks" : `Show all ${sugg.perWeek.length} weeks`}</Btn>}
        </>
      )}
    </div>
  );
}

const suggestionToSession = (row, o) => sessionAt(row, unitDefaults(row.course, row.section), o, uid());
