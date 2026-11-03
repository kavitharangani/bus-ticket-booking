import { useT } from '../i18n/index.js'
import { buildSeatRows } from '../lib/bookings.js'

export default function SeatMap({ total, taken, selected, onToggle }) {
  const t = useT()
  const rows = buildSeatRows(total)
  return (
    <div className="bus-frame">
      <div className="bus-front">
        <span>{t('seatMap.door')}</span>
        <span>{t('seatMap.driver')}</span>
      </div>
      <div className="seat-grid" role="group" aria-label={t('seatMap.group')}>
        {rows.flatMap((row, rowIndex) =>
          row.map((seat, seatIndex) => {
            if (seat === null) return <span key={`aisle-${rowIndex}-${seatIndex}`} className="aisle" />
            const isTaken = taken.has(seat)
            const isSelected = selected.includes(seat)
            return (
              <button
                key={seat}
                type="button"
                className={`seat${isTaken ? ' seat-taken' : ''}${isSelected ? ' seat-selected' : ''}`}
                style={{ '--row': rowIndex }}
                disabled={isTaken}
                aria-pressed={isSelected}
                aria-label={t(isTaken ? 'seatMap.seatBooked' : 'seatMap.seat', { n: seat })}
                onClick={() => onToggle(seat)}
              >
                {seat}
              </button>
            )
          }),
        )}
      </div>
      <ul className="seat-legend">
        <li><span className="seat-key" /> {t('seatMap.available')}</li>
        <li><span className="seat-key seat-key-selected" /> {t('seatMap.yours')}</li>
        <li><span className="seat-key seat-key-taken" /> {t('seatMap.booked')}</li>
      </ul>
    </div>
  )
}
