/* The real Nanogram icon set, converted from the APK's VectorDrawables.
   Single-colour icons render with `currentColor`, so they inherit CSS colour
   the same way the Compose tint did. */

const modules = import.meta.glob('../assets/icons/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const registry: Record<string, string> = {};
for (const [path, svg] of Object.entries(modules)) {
  const name = path.slice(path.lastIndexOf('/') + 1, -4);
  registry[name] = svg;
}

export type IconName = string;

export function hasIcon(name: string): boolean {
  return name in registry;
}

interface Props {
  name: IconName;
  size?: number | string;
  color?: string;
  className?: string;
  title?: string;
}

export function Icon({ name, size = 24, color, className, title }: Props) {
  const svg = registry[name];
  const dim = typeof size === 'number' ? `${size}px` : size;

  if (!svg) {
    if (import.meta.env.DEV) console.warn(`[icon] unknown icon: ${name}`);
    return <span style={{ width: dim, height: dim, display: 'inline-block' }} />;
  }

  return (
    <span
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      style={{
        width: dim,
        height: dim,
        display: 'inline-flex',
        flex: 'none',
        color,
        lineHeight: 0,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
