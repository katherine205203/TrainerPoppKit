import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CircleAlert, LoaderCircle, Sparkles } from "lucide-react";

export function BrandMark({ product = true }: { product?: boolean }) {
  return (
    <span className="brand-mark">
      <svg aria-hidden="true" viewBox="0 0 40 40" className="brand-petals">
        <circle cx="14" cy="14" r="9" fill="#3939ff" />
        <circle cx="26" cy="14" r="9" fill="#ff5b22" />
        <circle cx="14" cy="26" r="9" fill="#ff6bcb" />
        <circle cx="26" cy="26" r="9" fill="#f2bb05" />
      </svg>
      {product && <span className="brand-wordmark">Trainer<span>Popp!</span>Kit</span>}
    </span>
  );
}

export function Mascot({ kind = "flower", className = "" }: { kind?: "flower" | "sun" | "bean" | "spark"; className?: string }) {
  if (kind === "spark") {
    return <svg aria-hidden="true" viewBox="0 0 100 100" className={`mascot ${className}`}><path fill="currentColor" d="M50 4c8 23 15 31 46 46-31 15-38 23-46 46C42 73 35 65 4 50 35 35 42 27 50 4Z" /></svg>;
  }
  if (kind === "sun") {
    return <svg aria-hidden="true" viewBox="0 0 140 140" className={`mascot ${className}`}><path fill="currentColor" d="M70 3c10 0 17 22 26 26 9 4 31-5 38 3s-1 29 3 38c4 9 26 16 26 26s-22 17-26 26c-4 9 5 31-3 38s-29-1-38 3c-9 4-16 26-26 26s-17-22-26-26c-9-4-31 5-38-3s1-29-3-38C-1 110-23 103-23 93s22-17 26-26c4-9-5-31 3-38s29 1 38-3C53 22 60 3 70 3Z" transform="translate(18 18) scale(.75)"/><ellipse cx="55" cy="67" rx="9" ry="12" fill="#1f1f1f"/><ellipse cx="87" cy="67" rx="9" ry="12" fill="#1f1f1f"/><path d="M61 91q10 11 20 0" fill="none" stroke="#1f1f1f" strokeWidth="5" strokeLinecap="round"/></svg>;
  }
  if (kind === "bean") {
    return <svg aria-hidden="true" viewBox="0 0 120 110" className={`mascot ${className}`}><path fill="currentColor" d="M10 108V57C10 24 31 6 61 6s49 19 49 51v51H10Z"/><ellipse cx="51" cy="58" rx="11" ry="14" fill="#fff"/><ellipse cx="79" cy="58" rx="11" ry="14" fill="#fff"/><circle cx="54" cy="60" r="6" fill="#1f1f1f"/><circle cx="82" cy="60" r="6" fill="#1f1f1f"/><path d="M56 84q10 10 20 0" fill="none" stroke="#1f1f1f" strokeWidth="5" strokeLinecap="round"/></svg>;
  }
  return <svg aria-hidden="true" viewBox="0 0 120 120" className={`mascot ${className}`}><path fill="currentColor" d="M60 5c12 0 18 18 27 23 9 5 28-1 34 9 6 10-6 25-6 36s12 26 6 36c-6 10-25 4-34 9-9 5-15 23-27 23s-18-18-27-23c-9-5-28 1-34-9-6-10 6-25 6-36S-7 47-1 37C5 27 24 33 33 28 42 23 48 5 60 5Z" transform="translate(7 -3) scale(.88)"/><ellipse cx="48" cy="58" rx="10" ry="13" fill="#fff"/><ellipse cx="76" cy="58" rx="10" ry="13" fill="#fff"/><circle cx="50" cy="60" r="6" fill="#1f1f1f"/><circle cx="78" cy="60" r="6" fill="#1f1f1f"/><path d="M53 83q11 11 21 0" fill="none" stroke="#1f1f1f" strokeWidth="5" strokeLinecap="round"/></svg>;
}

export function Button({ children, variant = "primary", to, onClick, type = "button", disabled = false, icon, className = "" }: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger" | "yellow" | "orange";
  to?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const content = <>{children}{icon ?? (variant === "primary" ? <ArrowRight size={18} /> : null)}</>;
  const classes = `button button-${variant} ${className}`;
  if (to) return <Link className={classes} to={to}>{content}</Link>;
  return <button className={classes} type={type} onClick={onClick} disabled={disabled}>{content}</button>;
}

export function Badge({ children, tone = "purple" }: { children: ReactNode; tone?: "purple" | "orange" | "blue" | "green" | "pink" | "gray" | "yellow" | "aqua" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PageIntro({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-intro"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}<span className="title-dot">.</span></h1>{description && <p>{description}</p>}</div>{action && <div className="page-intro-action">{action}</div>}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function MetricCard({ icon, value, label, tone = "aqua" }: { icon: ReactNode; value: ReactNode; label: string; tone?: string }) {
  return <div className={`metric-card metric-${tone}`}><span className="metric-icon">{icon}</span><strong>{value}</strong><span>{label}</span></div>;
}

export function LoadingState({ label = "Loading your workspace…" }: { label?: string }) {
  return <div className="state-box"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="state-box state-error"><CircleAlert size={20} /><span>{message}</span>{retry && <button className="text-button" onClick={retry}>Try again</button>}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-spark"><Sparkles size={24} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function DemoNotice({ compact = false }: { compact?: boolean }) {
  return <div className={`demo-notice ${compact ? "demo-notice-compact" : ""}`}><span className="demo-dot">D</span><div><strong>DEMO ONLY</strong><span>Placeholder prompts and scoring are unapproved and not validated.</span></div></div>;
}

export function ColorDot({ color, className = "" }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={`color-dot ${className}`} style={{ backgroundColor: color }} />;
}
