import { useCountdown } from '../hooks/useCountdown';
import { formatInteger } from '../lib/format';

export function Countdown({ deadlineAt }: { deadlineAt: string }) {
  const value = useCountdown(deadlineAt);
  if (value.complete) {
    return (
      <section className="countdown countdown--complete" aria-label="Challenge deadline reached">
        <strong>Deadline reached</strong>
        <span>Final result locked to the record.</span>
      </section>
    );
  }
  const units = [
    ['Days', value.days],
    ['Hours', value.hours],
    ['Minutes', value.minutes],
    ['Seconds', value.seconds],
  ] as const;
  return (
    <section className="countdown" aria-label="Time remaining until January 1, 2035">
      <p className="countdown__label">Time left on the board</p>
      <div className="countdown__units">
        {units.map(([label, amount]) => (
          <div key={label}>
            <strong>
              {label === 'Days' ? formatInteger(amount) : String(amount).padStart(2, '0')}
            </strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
