import { createContext } from "react";

/** Who else is in the room and which session each person has open. */
export const PresenceCtx = createContext({ editing: {} });

/**
 * Room-level context for the UI.
 *   session   null when working alone, else { rid, code, role, roomName, userId, userName, userColor, uid, legacy }
 *   canEdit   false for viewers (read-only link)
 *   comments  { all, byAppt, open }  - empty when working alone
 *   api       { add(apptId,text), setResolved(c,bool), remove(c) }  - or null
 */
export const CollabCtx = createContext({ session: null, role: null, canEdit: true, inRoom: false, comments: { all: {}, byAppt: {}, open: {} }, api: null });
