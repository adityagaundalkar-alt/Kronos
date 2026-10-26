import { useCallback, useEffect, useRef, useState } from "react";
import { listVersions, newVersionId, saveVersion, deleteVersion } from "../firebase.js";
import { makeVersion, versionsToPrune, localVersions } from "../versions.js";
import { uid } from "../constants.js";

/** Saved versions of the open term (shared, in the database) or of this device's own timetable (local storage). */
export default function useVersions({ rid, who, canEdit }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lastAuto = useRef({});
  const ridRef = useRef(rid); ridRef.current = rid;

  const fetchList = useCallback(async () => (ridRef.current ? listVersions(ridRef.current) : localVersions.list("")), []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setList(await fetchList()); setError(""); }
    catch { setError("Couldn't load saved versions. Check your connection and try again."); }
    finally { setLoading(false); }
  }, [fetchList]);
  useEffect(() => { setList([]); refresh(); }, [rid, refresh]);

  /** Save `state` as a version. Resolves to "" on success or a message explaining what went wrong. */
  const save = useCallback(async (state, { name, kind = "manual" }) => {
    const v = makeVersion(state, { name, kind, by: who });
    try {
      if (ridRef.current) await saveVersion(ridRef.current, newVersionId(ridRef.current), v);
      else if (!localVersions.save("", uid() + uid(), v)) return "This device has no room left to save versions. Delete an old one first.";
      const all = await fetchList();
      for (const id of versionsToPrune(all)) { if (ridRef.current) await deleteVersion(ridRef.current, id); else localVersions.remove("", id); }
      setList(await fetchList());
      return "";
    } catch { return "Couldn't save the version. You may not have permission, or the term is archived."; }
  }, [who, fetchList]);

  /** A safety copy taken just before something large changes. Never interrupts the work and never throws. */
  const autoSave = useCallback((state, label) => {
    if (!canEdit) return;
    const now = Date.now();
    if (now - (lastAuto.current[label] || 0) < 60000) return;
    lastAuto.current[label] = now;
    save(state, { name: label, kind: "auto" });
  }, [canEdit, save]);

  const remove = useCallback(async id => {
    try { if (ridRef.current) await deleteVersion(ridRef.current, id); else localVersions.remove("", id); setList(await fetchList()); return ""; }
    catch { return "Couldn't delete the version."; }
  }, [fetchList]);

  return { list, loading, error, refresh, save, autoSave, remove };
}
