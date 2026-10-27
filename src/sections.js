// Sections: a course taught in several parts (Group 1, Group 2 ...), each with its own instructor, student groups
// and room. A session records the section's id and its name (the name is what the schedule shows and what the
// "parallel sections" clash rule compares).

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/** Stable id from the course and the name, so two people who convert the same sessions at once get the same sections. */
export const sectionId = (courseId, name) => `sec_${courseId}_${slug(name)}`;

export const blankSection = (courseId, name = "") => ({ id: courseId && name ? sectionId(courseId, name) : "sec_" + Math.random().toString(36).slice(2, 9), name, instructorId: "", groupIds: [], roomId: "", roomType: "" });

export const sectionsOf = course => (course && Array.isArray(course.sections) ? course.sections.filter(s => s && s.id) : []);

export function cleanSection(s) {
  return { id: s.id, name: s.name || "", instructorId: s.instructorId || "", groupIds: Array.isArray(s.groupIds) ? s.groupIds : [], roomId: s.roomId || "", roomType: s.roomType || "" };
}

const mostCommon = (items, keyOf = x => x) => {
  const n = new Map();
  items.forEach(x => { const k = keyOf(x); const e = n.get(k) || { x, c: 0 }; e.c++; n.set(k, e); });
  let best = null; n.forEach(e => { if (!best || e.c > best.c) best = e; });
  return best ? best.x : null;
};

/**
 * Sessions that carry a section name but no section: create the course's sections from them (the instructor, groups
 * and room most often used) and link the sessions. Returns the same object when there is nothing to do.
 */
export function migrateSections(state) {
  const apps = state.appointments || {};
  const courses = state.courses || [];
  const byCourse = new Map(courses.map(c => [c.id, c]));
  const todo = new Map(); // courseId -> Map(normalised name -> [appt])
  Object.values(apps).forEach(a => {
    if (!a || !a.courseId || a.sectionId || !String(a.section || "").trim() || !byCourse.has(a.courseId)) return;
    const name = String(a.section).trim();
    const m = todo.get(a.courseId) || todo.set(a.courseId, new Map()).get(a.courseId);
    const k = name.toLowerCase();
    (m.get(k) || m.set(k, []).get(k)).push(a);
  });
  if (!todo.size) return state;

  const newCourses = courses.map(c => {
    const m = todo.get(c.id);
    if (!m) return c;
    const secs = [...sectionsOf(c)];
    m.forEach((list, k) => {
      if (secs.some(s => s.name.trim().toLowerCase() === k)) return;
      const name = mostCommon(list.map(a => String(a.section).trim()));
      const groups = mostCommon(list.map(a => [...(a.groupIds || [])].sort()), g => g.join(","));
      secs.push({ ...blankSection(c.id, name), instructorId: mostCommon(list.map(a => a.instructorId).filter(Boolean)) || "", groupIds: groups || [], roomId: mostCommon(list.map(a => a.roomId).filter(Boolean)) || "" });
    });
    return { ...c, sections: secs };
  });

  const newApps = { ...apps };
  todo.forEach((m, courseId) => {
    const course = newCourses.find(c => c.id === courseId);
    m.forEach((list, k) => {
      const sec = sectionsOf(course).find(s => s.name.trim().toLowerCase() === k);
      list.forEach(a => { newApps[a.id] = { ...a, sectionId: sec.id, section: sec.name }; });
    });
  });
  return { ...state, courses: newCourses, appointments: newApps };
}

/** How many sections the migration would create (for the message shown afterwards). */
export const countNewSections = (before, after) =>
  (after.courses || []).reduce((n, c) => n + sectionsOf(c).length, 0) - (before.courses || []).reduce((n, c) => n + sectionsOf(c).length, 0);

/** Sessions of a course that use a section. */
export const sessionsInSection = (state, courseId, sId) => Object.values(state.appointments || {}).filter(a => a && a.courseId === courseId && a.sectionId === sId);
