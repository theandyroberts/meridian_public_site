import type { Plate, Gps } from "@platelab/shared";

/** Route drawn from the F9R telemetry path — orientation cue, not survey data. */
export function GpsPanel({ gps, plate }: { gps: Gps; plate: Plate }) {
  const { imu } = plate;
  const lats = gps.path.map((p) => p.lat);
  const lons = gps.path.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const pad = 0.15;
  const W = 320;
  const H = 180;

  const sx = (lon: number) =>
    ((lon - minLon) / (maxLon - minLon || 1e-9)) * W * (1 - 2 * pad) + W * pad;
  const sy = (lat: number) =>
    H - (((lat - minLat) / (maxLat - minLat || 1e-9)) * H * (1 - 2 * pad) + H * pad);

  const d = gps.path
    .map((p, i) => `${i ? "L" : "M"} ${sx(p.lon).toFixed(1)} ${sy(p.lat).toFixed(1)}`)
    .join(" ");

  return (
    <div className="side-card">
      <h2>Route telemetry</h2>
      <span className="mono block-label">{gps.source}</span>
      <svg className="gps-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="GPS route">
        {/* graticule */}
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} stroke="rgba(244,241,234,0.07)">
            <line x1={W * f} y1="0" x2={W * f} y2={H} />
            <line x1="0" y1={H * f} x2={W} y2={H * f} />
          </g>
        ))}
        <path d={d} fill="none" stroke="#C56B3E" strokeWidth="2" strokeLinecap="round" />
        <circle cx={sx(gps.start.lon)} cy={sy(gps.start.lat)} r="4" fill="#F4F1EA" />
        <circle cx={sx(gps.end.lon)} cy={sy(gps.end.lat)} r="4.5" fill="#C56B3E" />
      </svg>
      <div className="gps-stats">
        <div>
          <span className="mono dimmer">Start</span>
          <strong>
            {gps.start.lat.toFixed(4)}, {gps.start.lon.toFixed(4)}
          </strong>
        </div>
        <div>
          <span className="mono dimmer">End</span>
          <strong>
            {gps.end.lat.toFixed(4)}, {gps.end.lon.toFixed(4)}
          </strong>
        </div>
        <div>
          <span className="mono dimmer">Avg speed</span>
          <strong>{gps.avgSpeedMph} mph</strong>
        </div>
        <div>
          <span className="mono dimmer">Max speed</span>
          <strong>{gps.maxSpeedMph} mph</strong>
        </div>
      </div>
      <div className="imu-row">
        <span className={`imu-dot ${imu.collected ? "on" : ""}`} />
        <span className="mono-md">
          {imu.collected
            ? `IMU collected · ${imu.source}${imu.rateHz ? ` @ ${imu.rateHz}Hz` : ""}`
            : "IMU not collected on this take"}
        </span>
      </div>
    </div>
  );
}
