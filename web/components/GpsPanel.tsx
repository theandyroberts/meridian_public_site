import type { Plate, Gps } from "@platelab/shared";

const MAP_W = 320;
const MAP_H = 190;
const TILE = 256;

function worldPoint(lat: number, lon: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const clippedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clippedLat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function routeMap(gps: Gps) {
  let zoom = 18;
  let points = gps.path.map((point) => worldPoint(point.lat, point.lon, zoom));
  while (zoom > 3) {
    const width = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
    const height = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
    if (width <= MAP_W * 0.68 && height <= MAP_H * 0.62) break;
    zoom -= 1;
    points = gps.path.map((point) => worldPoint(point.lat, point.lon, zoom));
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const left = (minX + maxX) / 2 - MAP_W / 2;
  const top = (minY + maxY) / 2 - MAP_H / 2;
  const firstTileX = Math.floor(left / TILE);
  const lastTileX = Math.floor((left + MAP_W) / TILE);
  const firstTileY = Math.floor(top / TILE);
  const lastTileY = Math.floor((top + MAP_H) / TILE);
  const tileCount = 2 ** zoom;
  const tiles = [];
  for (let y = firstTileY; y <= lastTileY; y++) {
    if (y < 0 || y >= tileCount) continue;
    for (let x = firstTileX; x <= lastTileX; x++) {
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}-${x}-${y}`,
        src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
        left: x * TILE - left,
        top: y * TILE - top,
      });
    }
  }
  return {
    zoom,
    tiles,
    points: points.map((point) => ({ x: point.x - left, y: point.y - top })),
  };
}

/** Route overlay on OpenStreetMap tiles; technical coordinates remain visible below. */
export function GpsPanel({ gps, plate }: { gps: Gps; plate: Plate }) {
  const { imu } = plate;
  const map = routeMap(gps);
  const route = map.points
    .map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const start = map.points[0];
  const end = map.points[map.points.length - 1];

  return (
    <div className="side-card">
      <h2>Route telemetry</h2>
      <span className="mono block-label">{gps.source}</span>
      <div className="gps-map" role="img" aria-label="GPS route over a street map">
        {map.tiles.map((tile) => (
          // OSM raster tiles are decorative beneath the accessible route description.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            src={tile.src}
            alt=""
            draggable={false}
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} aria-hidden="true">
          <path className="gps-route-halo" d={route} />
          <path className="gps-route-line" d={route} />
          <circle cx={start.x} cy={start.y} r="5" className="gps-route-start" />
          <circle cx={end.x} cy={end.y} r="5" className="gps-route-end" />
        </svg>
        <a
          className="gps-attribution"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap
        </a>
      </div>
      <div className="gps-stats">
        <div className="gps-location-stat">
          <span className="mono dimmer">Start</span>
          <strong>{gps.startLocation?.label ?? "Street lookup unavailable"}</strong>
          <small className="mono dimmer">
            {gps.start.lat.toFixed(4)}, {gps.start.lon.toFixed(4)}
          </small>
        </div>
        <div className="gps-location-stat">
          <span className="mono dimmer">End</span>
          <strong>{gps.endLocation?.label ?? "Street lookup unavailable"}</strong>
          <small className="mono dimmer">
            {gps.end.lat.toFixed(4)}, {gps.end.lon.toFixed(4)}
          </small>
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
