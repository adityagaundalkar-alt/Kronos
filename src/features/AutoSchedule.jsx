import { useState, useMemo } from "react";
import { DAYS as ALL_DAYS, DAYS_FULL, uid, ROOM_TYPES, getPalette } from "../constants.js";
const DAYS = ALL_DAYS.slice(0, DAY_COUNT); // the auto-scheduler places sessions Monday to Friday
import { DAY_COUNT, runAutoSchedule, slotMatrix, jobWeeks, seatsNeeded, reasonText, ALL_WEEKS } from "../scheduler.js";
import { Btn, Badge, Field, MultiSelect, Segmented, EmptyState } from "../ui/kit.jsx";
import Icon from "../ui/Icon.jsx";
import AvailabilityGrid from "./AvailabilityGrid.jsx";

const MODES = [
  { value: "prefer", label: "Same time, move blocked weeks", help: "Uses one weekly time. If it's blocked in some week (a clash or a holiday), that week moves to another time." },
  { value: "strict", label: "Same time every week", help: "One weekly time only. Weeks where it's blocked are left empty." },
  { value: "free", label: "Any time each week", help: "Every week is placed separately, favouring the most-used time." },
];

const blankJob = () => ({
  id: uid(), courseId: "", instructorId: "", groupIds: [], roomId: "", preferRoomType: "", ignoreCapacity: false,
  weeksMode: "all", weekStart: 1, weekEnd: 16, customWeeks: [], sessionsPerWeek: 1, mode: "prefer",
  useInstructorAvailability: true, preferDays: [], preferSlots: [], avoidSlots: [], replaceExisting: false, requireAll: false, _open: true,
});

const toEngine = job => ({ ...job, weeks: jobWeeks(job) });
const weekText = w => w.length === 16 ? "all 16 weeks" : w.length === 1 ? `week ${w[0]}` : w.length === w[w.length - 1] - w[0] + 1 ? `weeks ${w[0]} to ${w[w.length - 1]}` : `${w.length} weeks`;

function Chips({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map(o => {
        const on = value.includes(o.value);
        return <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== o.value) : [...value, o.value])}
          className={`btn xs ${on ? "accent" : "outline"}`}>{o.label}</button>;
      })}
    </div>
  );
}

function JobCard({ job, ji, state, onUpdate, onRemove, onToggle, onInstructorAvailability }) {
  const { courses, instructors, groups, rooms, slots } = state;
  const course = courses.find(c => c.id === job.courseId);
  const instr = instructors.find(i => i.id === job.instructorId);
  const pal = course ? getPalette(course.id, courses) : null;
  const needed = seatsNeeded(job, groups);
  const biggest = rooms.length ? Math.max(...rooms.map(r => Number(r.capacity) || 0)) : 0;
  const matrix = useMemo(() => job.courseId ? slotMatrix(state, toEngine(job)) : null,
    [job, state.appointments, state.instructors, state.rooms, state.groups, state.holidays, state.slots, state.week1Start]);

  function pickCourse(courseId) {
    const c = courses.find(x => x.id === courseId);
    onUpdate({ courseId, instructorId: c?.defaultInstructorId || "", groupIds: c?.defaultGroupIds || [] });
  }
  const weeks = jobWeeks(job);

  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderLeft: `4px solid ${pal ? pal.accent : "var(--border2)"}`, borderRadius: "var(--r2)", overflow: "hidden", flexShrink: 0 }}>
      <button type="button" onClick={onToggle} aria-expanded={job._open}
        style={{ width: "100%", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: job._open ? "var(--bg3)" : "transparent", borderBottom: job._open ? "1px solid var(--border)" : "none" }}>
        <span style={{ font: "600 13px var(--mono)", color: "var(--muted2)", width: 20 }}>{ji + 1}</span>
        <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {course ? `${course.code}  ${course.name}` : "New job: choose a course"}
        </span>
        {matrix && <Badge color={matrix.feasible > 0 ? "green" : "yellow"}>{matrix.feasible > 0 ? `${matrix.feasible} time${matrix.feasible === 1 ? "" : "s"} free every week` : "No time free every week"}</Badge>}
        <Icon name={job._open ? "up" : "down"} size={16} style={{ color: "var(--muted)" }} />
      </button>

      {job._open && (
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 14px" }}>
            <Field label="Course" required>
              <select value={job.courseId} onChange={e => pickCourse(e.target.value)}>
                <option value="">Choose a course…</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.code}  {c.name}</option>)}
              </select>
            </Field>
            <Field label="Instructor">
              <select value={job.instructorId} onChange={e => onUpdate({ instructorId: e.target.value })}>
                <option value="">None</option>
                {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Student groups" hint="The scheduler avoids clashes for these groups, and picks a room big enough for them.">
            <MultiSelect options={groups.map(g => ({ value: g.id, label: `${g.name}${g.size ? ` (${g.size})` : ""}` }))} value={job.groupIds} onChange={v => onUpdate({ groupIds: v })} placeholder="Choose groups…" />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 14px" }}>
            <Field label="Sessions per week">
              <select value={job.sessionsPerWeek} onChange={e => onUpdate({ sessionsPerWeek: +e.target.value })}>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}{n > 1 ? " (on different days)" : ""}</option>)}
              </select>
            </Field>
            <Field label="Weeks">
              <Segmented label="Weeks" value={job.weeksMode} onChange={v => onUpdate({ weeksMode: v })}
                options={[{ value: "all", label: "All 16" }, { value: "range", label: "A range" }, { value: "custom", label: "Pick weeks" }]} />
            </Field>
          </div>
          {job.weeksMode === "range" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, maxWidth: 360 }}>
              <select aria-label="First week" value={job.weekStart} onChange={e => onUpdate({ weekStart: +e.target.value, weekEnd: Math.max(job.weekEnd, +e.target.value) })}>
                {ALL_WEEKS.map(w => <option key={w} value={w}>Week {w}</option>)}
              </select>
              <span style={{ color: "var(--muted)" }}>to</span>
              <select aria-label="Last week" value={job.weekEnd} onChange={e => onUpdate({ weekEnd: +e.target.value })}>
                {ALL_WEEKS.filter(w => w >= job.weekStart).map(w => <option key={w} value={w}>Week {w}</option>)}
              </select>
            </div>
          )}
          {job.weeksMode === "custom" && (
            <div style={{ marginBottom: 14 }}>
              <Chips label="Weeks" options={ALL_WEEKS.map(w => ({ value: w, label: `W${w}` }))} value={job.customWeeks} onChange={v => onUpdate({ customWeeks: [...v].sort((a, b) => a - b) })} />
              {!job.customWeeks.length && <div className="hint" style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Nothing picked yet, so all 16 weeks will be used.</div>}
            </div>
          )}

          <fieldset className="field" style={{ border: "none" }}>
            <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, padding: 0 }}>How should weeks line up?</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {MODES.map(m => (
                <label key={m.value} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 10px", borderRadius: "var(--r)", border: `1px solid ${job.mode === m.value ? "var(--accent-line)" : "var(--border)"}`, background: job.mode === m.value ? "var(--accent-soft)" : "transparent", cursor: "pointer" }}>
                  <input type="radio" name={`mode-${job.id}`} checked={job.mode === m.value} onChange={() => onUpdate({ mode: m.value })} style={{ marginTop: 3, width: "auto", minHeight: 0, accentColor: "var(--accent)" }} />
                  <span><span style={{ fontWeight: 600, fontSize: 14 }}>{m.label}</span><br /><span style={{ fontSize: 13, color: "var(--muted)" }}>{m.help}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 14px" }}>
            <Field label="Fixed room (optional)" hint="Leave on automatic to pick the smallest room that fits.">
              <select value={job.roomId} onChange={e => onUpdate({ roomId: e.target.value })}>
                <option value="">Choose automatically</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.capacity} seats)</option>)}
              </select>
            </Field>
            <Field label="Preferred room type">
              <select value={job.preferRoomType} onChange={e => onUpdate({ preferRoomType: e.target.value })}>
                <option value="">Any</option>
                {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14, marginBottom: 6 }}>
            <input type="checkbox" checked={job.ignoreCapacity} onChange={e => onUpdate({ ignoreCapacity: e.target.checked })} style={{ marginTop: 3 }} />
            <span>Ignore room size</span>
          </label>
          <div className={`callout ${!job.ignoreCapacity && needed > biggest && rooms.length ? "warn" : ""}`} style={{ marginBottom: 14 }}>
            {job.ignoreCapacity ? "Room size isn't checked for this job."
              : needed === 0 ? "Choose student groups and the scheduler will pick a room with enough seats."
              : `Needs ${needed} seats, from the groups you chose. ${rooms.length ? `The largest room has ${biggest}.` : "No rooms are defined yet."}${needed > biggest && rooms.length ? " No room is big enough, so nothing can be placed unless you split the groups or ignore room size." : ""}`}
          </div>

          <details style={{ marginBottom: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14, padding: "4px 0" }}>Preferences (optional)</summary>
            <div style={{ paddingTop: 10 }}>
              <div className="hint" style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>Preferences only break ties between times that already work. They never override a clash, a holiday or room size.</div>
              <Field label="Prefer these days"><Chips label="Preferred days" options={DAYS.map((d, i) => ({ value: i, label: d }))} value={job.preferDays} onChange={v => onUpdate({ preferDays: v })} /></Field>
              <Field label="Prefer these times"><Chips label="Preferred times" options={state.slots.map(s => ({ value: s.id, label: s.short }))} value={job.preferSlots} onChange={v => onUpdate({ preferSlots: v })} /></Field>
              <Field label="Avoid these times"><Chips label="Times to avoid" options={state.slots.map(s => ({ value: s.id, label: s.short }))} value={job.avoidSlots} onChange={v => onUpdate({ avoidSlots: v })} /></Field>
            </div>
          </details>

          <fieldset style={{ border: "none", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend className="sr-only">Options</legend>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={job.replaceExisting} onChange={e => onUpdate({ replaceExisting: e.target.checked })} style={{ marginTop: 3 }} />
              <span>Replace this course's existing sessions in these weeks <span style={{ color: "var(--muted)" }}>(pinned sessions are never touched)</span></span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={job.requireAll} onChange={e => onUpdate({ requireAll: e.target.checked })} style={{ marginTop: 3 }} />
              <span>All weeks or nothing <span style={{ color: "var(--muted)" }}>(skip the job if any week can't be placed)</span></span>
            </label>
            {instr && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={job.useInstructorAvailability} onChange={e => onUpdate({ useInstructorAvailability: e.target.checked })} style={{ marginTop: 3 }} />
                <span>Only use times {instr.name} is available</span>
              </label>
            )}
          </fieldset>

          {matrix && (
            <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>What's free for {weekText(weeks)}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Each cell shows in how many of the weeks that time works for the instructor, groups and a room.</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "separate", borderSpacing: 3, width: "100%", minWidth: 340 }}>
                  <thead><tr><th />{DAYS.map(d => <th key={d} style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>{d}</th>)}</tr></thead>
                  <tbody>
                    {state.slots.map(slot => (
                      <tr key={slot.id}>
                        <td style={{ fontSize: 13, color: "var(--muted)", paddingRight: 8, whiteSpace: "nowrap" }}>{slot.short}</td>
                        {DAYS.map((_, di) => {
                          const c = matrix.cells[`${di}_${slot.id}`];
                          const tone = c.status === "free" ? ["var(--accent-soft)", "var(--accent-line)", "var(--accent)"]
                            : c.status === "partial" ? ["var(--warn-soft)", "var(--warn-line)", "var(--warn)"]
                            : c.status === "blocked" ? ["var(--danger-soft)", "var(--danger-line)", "var(--danger)"] : ["var(--bg4)", "var(--border)", "var(--muted2)"];
                          const why = c.status === "unavailable" ? "Outside the instructor's availability" : c.reasons.map(r => `${reasonText(r.code)} (${r.count} week${r.count === 1 ? "" : "s"})`).join("; ") || (c.holidays ? "Holiday in some weeks" : "Free");
                          return (
                            <td key={di} style={{ textAlign: "center" }}>
                              <div title={`${DAYS_FULL[di]} ${slot.short}: ${why}`} style={{ height: 30, borderRadius: 6, display: "grid", placeItems: "center", font: "600 12px var(--mono)", background: tone[0], border: `1px solid ${tone[1]}`, color: tone[2] }}>
                                {c.status === "unavailable" ? "–" : `${c.freeWeeks}/${c.weeks - (c.holidays || 0)}`}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {instr && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14, padding: "4px 0" }}>Edit {instr.name}'s weekly availability</summary>
              <div style={{ paddingTop: 8 }}><AvailabilityGrid availability={instr.availability || {}} onChange={a => onInstructorAvailability(instr.id, a)} slots={slots} compact /></div>
            </details>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <Btn variant="ghost" onClick={onRemove}><Icon name="trash" size={15} /> Remove job</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({ r, state, included, onInclude }) {
  const { rooms, slots, instructors } = state;
  const pal = getPalette(r.course?.id, state.courses);
  const tone = r.status === "full" ? "green" : r.status === "partial" ? "yellow" : "red";
  const label = r.status === "full" ? "All placed" : r.status === "partial" ? `${r.placed.length} placed, some weeks missing` : "Nothing placed";
  const instrName = instructors.find(i => i.id === r.job.instructorId)?.name;
  const byWeek = [...r.placed].sort((a, b) => a.weekNum - b.weekNum || a.dayIdx - b.dayIdx);
  const missing = r.missing.filter(m => !m.holiday);
  return (
    <section style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderLeft: `4px solid ${pal.accent}`, borderRadius: "var(--r2)", padding: "12px 14px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ font: "600 13px var(--mono)", color: pal.accent }}>{r.course?.code}</span>
        <strong style={{ fontSize: 15 }}>{r.course?.name || "Unknown course"}</strong>
        {instrName && <span style={{ color: "var(--muted)", fontSize: 13 }}>{instrName}</span>}
        <div style={{ flex: 1 }} />
        <Badge color={tone}>{label}</Badge>
        {r.placed.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
            <input type="checkbox" checked={included} onChange={e => onInclude(e.target.checked)} /> Add to timetable
          </label>
        )}
      </div>

      {r.removed.length > 0 && <div className="callout warn" style={{ marginTop: 10 }}>Replaces {r.removed.length} existing session{r.removed.length === 1 ? "" : "s"} of this course.</div>}

      {byWeek.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
          {byWeek.map(a => {
            const room = rooms.find(x => x.id === a.roomId);
            return <span key={a.id} style={{ font: "500 12px var(--mono)", padding: "3px 8px", borderRadius: 5, background: "var(--bg3)", border: "1px solid var(--border)" }}>
              W{a.weekNum} {DAYS[a.dayIdx]} {slots.find(s => s.id === a.timeId)?.short || a.timeId}{room ? ` · ${room.name}` : ""}</span>;
          })}
        </div>
      )}

      {missing.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 14 }}>
          <strong>Couldn't place:</strong> {[...new Set(missing.map(m => `week ${m.weekNum}`))].join(", ")}
        </div>
      )}
      {r.explanation.length > 0 && (
        <ul style={{ margin: "8px 0 0 18px", fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
          {r.explanation.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
      {r.suggestions.length > 0 && (
        <div className="callout info" style={{ marginTop: 10 }}>
          <strong>What would help:</strong>
          <ul style={{ margin: "4px 0 0 18px" }}>{r.suggestions.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

export default function AutoScheduleTab({ state, setState, toast }) {
  const [jobs, setJobs] = useState([blankJob()]);
  const [result, setResult] = useState(null);       // engine output once run
  const [included, setIncluded] = useState({});     // job id -> bool

  const updateJob = (id, patch) => setJobs(j => j.map(x => x.id === id ? { ...x, ...patch } : x));
  const ready = jobs.filter(j => j.courseId);

  function run() {
    const res = runAutoSchedule(state, ready.map(toEngine), { makeId: uid });
    setResult(res);
    setIncluded(Object.fromEntries(res.reports.map(r => [r.job.id, r.placed.length > 0])));
  }
  function commit() {
    const take = result.reports.filter(r => included[r.job.id] && r.placed.length);
    const add = take.flatMap(r => r.placed);
    const drop = new Set(take.flatMap(r => r.removed));
    if (!add.length) return;
    setState(s => {
      const next = { ...s.appointments };
      drop.forEach(id => delete next[id]);
      add.forEach(a => { next[a.id] = a; });
      return { ...s, appointments: next, changelog: [...s.changelog.slice(-199), { at: Date.now(), action: "Auto-scheduled", detail: `${add.length} sessions across ${new Set(add.map(a => a.courseId)).size} course(s)${drop.size ? `, replacing ${drop.size}` : ""}` }] };
    }, "auto-scheduled", `${add.length} sessions`);
    toast(`${add.length} session${add.length === 1 ? "" : "s"} added${drop.size ? `, ${drop.size} replaced` : ""}`, "ok");
    setResult(null); setJobs([blankJob()]);
  }
  const instructorAvailability = (id, availability) => setState(s => ({ ...s, instructors: s.instructors.map(i => i.id === id ? { ...i, availability } : i) }));

  // ── Results ──
  if (result) {
    const chosen = result.reports.filter(r => included[r.job.id] && r.placed.length);
    const total = chosen.reduce((n, r) => n + r.placed.length, 0);
    const swapped = chosen.reduce((n, r) => n + r.removed.length, 0);
    const failed = result.reports.filter(r => r.status !== "full").length;
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", minHeight: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
          <Btn variant="outline" size="md" onClick={() => setResult(null)}><Icon name="left" size={16} /> Back to setup</Btn>
          <div style={{ flex: 1, minWidth: 180 }}>
            <strong>{total} session{total === 1 ? "" : "s"} ready to add</strong>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{failed ? `${failed} job${failed === 1 ? "" : "s"} need attention. ` : "Everything fit. "}Nothing changes until you add them.{swapped ? ` ${swapped} existing will be replaced.` : ""}</div>
          </div>
          <Btn variant="primary" size="md" onClick={commit} disabled={!total}>Add {total || ""} to timetable</Btn>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 28px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          {result.reports.map(r => <ResultCard key={r.job.id} r={r} state={state} included={!!included[r.job.id]} onInclude={v => setIncluded(m => ({ ...m, [r.job.id]: v }))} />)}
        </div>
      </div>
    );
  }

  // ── Setup ──
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", minHeight: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 220, color: "var(--muted)", fontSize: 14 }}>Describe what needs a place. The scheduler finds times with no clashes, no holidays and a room that fits, then shows you the result before anything is added.</div>
        <Btn variant="outline" size="md" onClick={() => setJobs(j => [...j, blankJob()])}><Icon name="plus" size={16} /> Add job</Btn>
        <Btn variant="primary" size="md" onClick={run} disabled={!ready.length}><Icon name="wand" size={16} /> Find times</Btn>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 28px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        {state.courses.length === 0 && <EmptyState title="Add a course first">Jobs are built from your courses. Add one on the Courses page, then come back.</EmptyState>}
        {jobs.map((job, ji) => (
          <JobCard key={job.id} job={job} ji={ji} state={state} onUpdate={p => updateJob(job.id, p)}
            onRemove={() => setJobs(j => j.length > 1 ? j.filter(x => x.id !== job.id) : [blankJob()])}
            onToggle={() => updateJob(job.id, { _open: !job._open })} onInstructorAvailability={instructorAvailability} />
        ))}
      </div>
    </div>
  );
}
