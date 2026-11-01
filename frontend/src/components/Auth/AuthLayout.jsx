export default function AuthLayout({ children }) {
  return (
    <div className="auth-screen">
      <style>{`
        .auth-screen {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in srgb, var(--accent) 10%, transparent), var(--bg-0) 60%);
          padding: var(--space-5);
        }
        .auth-card {
          width: 100%;
          max-width: 380px;
        }
        .auth-brand {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          color: var(--accent);
          font-weight: 600;
          font-size: 14px;
          margin-bottom: var(--space-5);
        }
        .auth-card h1 {
          font-size: 22px;
          margin: 0 0 var(--space-2);
          font-weight: 600;
        }
        .auth-subtitle {
          color: var(--text-secondary);
          font-size: 14px;
          margin: 0 0 var(--space-5);
        }
        .auth-switch {
          text-align: center;
          font-size: 13.5px;
          color: var(--text-secondary);
          margin: var(--space-5) 0 0;
        }
        .auth-switch a {
          color: var(--accent);
          text-decoration: none;
        }
        .auth-switch a:hover {
          text-decoration: underline;
        }
      `}</style>
      {children}
    </div>
  );
}
