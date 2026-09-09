import type { ComponentChildren } from 'preact';
import { HelpTip } from './HelpTip.tsx';

export interface HelpInfo {
  text: string;
  href?: string;
}

// Section shell for the numbered views (docs/ui-information-design §3). Heading,
// optional measurement-condition subtitle, body. No self-explaining prose
// beyond a subtitle (ADR-0014) — `help` adds only a supplementary ❔ tooltip
// (docs/ui-reading-guide.md has the detailed reading guide).
//
// `help`'s HelpTip is rendered as a SIBLING of <h3> inside a `.sec-head`
// wrapper, never as a child of <h3> — app.test.tsx asserts exact `h3`
// textContent for every panel title (and for the dynamic `Request #N`
// title), so the icon must not become part of that text node.
export function Section({
  id,
  title,
  subtitle,
  help,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  help?: HelpInfo;
  children: ComponentChildren;
}): ComponentChildren {
  return (
    <section id={id}>
      <div class="sec-head">
        <h3>{title}</h3>
        {help ? <HelpTip text={help.text} href={help.href} /> : null}
      </div>
      {subtitle ? <p class="sub">{subtitle}</p> : null}
      {children}
    </section>
  );
}

export interface KvPair {
  label: ComponentChildren;
  value: ComponentChildren;
  help?: HelpInfo;
}

// The <dl class="kv"> label/value grid used by the Overview view.
export function Kv({ rows }: { rows: KvPair[] }): ComponentChildren {
  return (
    <dl class="kv">
      {rows.map((r, i) => [
        <dt key={'dt' + i}>
          {r.label}
          {r.help ? <HelpTip text={r.help.text} href={r.help.href} /> : null}
        </dt>,
        <dd key={'dd' + i}>{r.value}</dd>,
      ])}
    </dl>
  );
}

export function Note({ children }: { children: ComponentChildren }): ComponentChildren {
  return <div class="note">{children}</div>;
}

export function Warn({ children }: { children: ComponentChildren }): ComponentChildren {
  return <div class="warn">{children}</div>;
}
