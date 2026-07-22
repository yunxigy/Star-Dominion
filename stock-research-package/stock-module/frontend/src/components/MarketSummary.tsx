type Props = {
  text: string;
  className?: string;
};

export function MarketSummary({ text, className = "market-summary" }: Props) {
  const lines = text
    .split(/[；\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <ul className={className} aria-label="隔夜主题摘要">
      {lines.map((line, index) => (
        <li data-testid="market-summary-line" key={`${index}-${line}`}>
          {line}
        </li>
      ))}
    </ul>
  );
}
