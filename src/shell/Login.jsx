import { useState } from "react";
import { signInWithGoogle, explainAuthError } from "../firebase.js";
import { Btn } from "../ui/kit.jsx";

export default function LoginScreen({ onSkip }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function handleGoogle() {
    setLoading(true); setError("");
    try { await signInWithGoogle(); }
    catch (e) { const x = explainAuthError(e); if (!x.silent) setError(x.message); }
    setLoading(false);
  }
  return (
    <main style={{ position: "fixed", inset: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", background: "var(--bg)", overflowY: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", minHeight: "100%" }}>
        <section style={{ background: "var(--ink)", color: "var(--ink-strong)", padding: "clamp(28px, 6vw, 64px)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 32 }}>
          <div className="brand" style={{ padding: 0 }}><span className="brand-mark" aria-hidden="true">K</span><span className="brand-name">Kronos<small>2.0</small></span></div>
          <div>
            <h1 style={{ font: "400 clamp(40px, 6vw, 68px)/1.02 var(--serif)", letterSpacing: "-.01em", maxWidth: "12ch" }}>Every class in its place.</h1>
            <p style={{ color: "var(--ink-text)", fontSize: 17, lineHeight: 1.5, maxWidth: "38ch", marginTop: 16 }}>
              Build the teaching timetable with your team, catch clashes before students do, and share a read-only view with instructors.
            </p>
          </div>
          <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, maxWidth: 360, opacity: .9 }}>
            {Array.from({ length: 15 }, (_, i) => {
              const filled = [0, 3, 4, 6, 8, 10, 13].includes(i), clash = i === 8;
              return <div key={i} style={{ height: 24, borderRadius: 4, background: clash ? "var(--danger)" : filled ? "var(--accent)" : "rgba(255,255,255,.08)", opacity: filled ? 1 : 1 }} />;
            })}
          </div>
        </section>
        <section style={{ padding: "clamp(24px, 5vw, 56px)", display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 520 }}>
          <h2 style={{ font: "400 32px/1.1 var(--serif)", marginBottom: 8 }}>Welcome</h2>
          <p style={{ color: "var(--muted)", marginBottom: 22, lineHeight: 1.5 }}>Sign in to keep your timetable in the cloud and open it from any device. You can also start without an account.</p>
          <Btn variant="outline" size="md" onClick={handleGoogle} disabled={loading} style={{ width: "100%", minHeight: 46, marginBottom: 10 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
              <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" />
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" />
            </svg>
            {loading ? "Signing in…" : "Continue with Google"}
          </Btn>
          {error && <div className="callout bad" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
          <Btn variant="primary" size="md" onClick={onSkip} style={{ width: "100%", minHeight: 46 }}>Continue without an account</Btn>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 16, lineHeight: 1.5 }}>Without an account, your timetable stays in this browser. Joining a shared room never needs an account.</p>
        </section>
      </div>
    </main>
  );
}
