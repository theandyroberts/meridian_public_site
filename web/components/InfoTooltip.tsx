export function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="info-tooltip">
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-label={text}
        aria-describedby="expand-search-help"
      >
        i
      </button>
      <span id="expand-search-help" role="tooltip" className="info-tooltip-copy">
        {text}
      </span>
    </span>
  );
}
