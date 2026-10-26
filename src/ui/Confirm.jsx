import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Btn, Modal } from "./kit.jsx";

const ConfirmCtx = createContext(() => Promise.resolve(true));
let ask = () => Promise.resolve(true);
/** Same as useConfirm, for code that is not a component or hook. Resolves true when the person confirms. */
export const askConfirm = opts => ask(opts);

/** `const confirm = useConfirm(); if (await confirm({ title, message, confirmLabel })) …` */
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const resolver = useRef(null);
  const confirm = useCallback(opts => new Promise(res => { resolver.current?.(false); resolver.current = res; setReq(opts); }), []);
  ask = confirm;
  const done = ok => { const r = resolver.current; resolver.current = null; setReq(null); r?.(ok); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {req && (
        <Modal title={req.title || "Are you sure?"} onClose={() => done(false)} width={440}>
          <div style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 18 }}>{req.message}</div>
          {req.detail && <div className="callout warn" style={{ marginBottom: 18 }}>{req.detail}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Btn variant="outline" onClick={() => done(false)}>Cancel</Btn>
            <Btn variant={req.danger === false ? "primary" : "danger"} onClick={() => done(true)}>{req.confirmLabel || "Delete"}</Btn>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
