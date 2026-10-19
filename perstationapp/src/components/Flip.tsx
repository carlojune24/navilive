/** Renders text as fixed-cell characters that flip in one after another. Re-mount via `key` to replay. */
export function Flip({ text }: { text: string }) {
  return (
    <span role="img" aria-label={text} className="inline-flex">
      {[...text].map((c, i) => (
        <span key={i} aria-hidden className="flip-char" style={{ ["--i" as string]: i }}>
          {c === " " ? " " : c}
        </span>
      ))}
    </span>
  );
}
