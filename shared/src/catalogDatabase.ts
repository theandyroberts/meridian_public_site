import { CAMERA_IDS, type Plate } from "./catalog";

export const CATALOG_IMPORT_SOURCE = "catalog-json";

type JsonRecord = Record<string, unknown>;

export interface CatalogDatabaseRecord {
  stockClip: JsonRecord;
  assets: JsonRecord[];
  descriptors: JsonRecord[];
  segment: JsonRecord;
  clipEmbeddingInput: string;
  segmentEmbeddingInput: string;
}

export function catalogDatabaseRecordForPlate(
  plate: Plate,
  sourceVersion: string,
  source = CATALOG_IMPORT_SOURCE,
): CatalogDatabaseRecord {
  const objectLabels = plate.objects.map((object) => object.label);
  const locationParts = [
    plate.location.name,
    plate.location.city,
    plate.location.region,
    plate.location.country,
  ];
  const searchTerms = uniqueNonEmpty([
    plate.title,
    plate.description,
    plate.shotType,
    plate.timeOfDay,
    plate.weather,
    plate.season,
    plate.speedBand,
    ...plate.tags,
    ...objectLabels,
    ...locationParts,
    ...plate.stageCompat,
    plate.rig,
    plate.gps ? `${plate.gps.avgSpeedMph} mph average` : undefined,
    plate.gps ? `${plate.gps.maxSpeedMph} mph maximum` : undefined,
    plate.imu.collected ? "IMU telemetry collected" : undefined,
  ]);
  const embeddingLines = [
    `Title: ${plate.title}`,
    `Description: ${plate.description}`,
    `Environment: ${plate.shotType}; ${plate.timeOfDay}; ${plate.weather}; ${plate.season}`,
    plate.speedBand ? `Motion: ${plate.speedBand}` : undefined,
    `Location: ${locationParts.join(", ")}`,
    `Tags: ${plate.tags.join(", ")}`,
    `Visible objects: ${objectLabels.join(", ") || "none labeled"}`,
    `Stage compatibility: ${plate.stageCompat.join(", ")}`,
    plate.gps
      ? `Vehicle speed: ${plate.gps.avgSpeedMph} mph average, ${plate.gps.maxSpeedMph} mph maximum`
      : undefined,
    plate.imu.collected
      ? `Motion telemetry: ${plate.imu.source ?? "IMU"}${plate.imu.rateHz ? ` at ${plate.imu.rateHz} Hz` : ""}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  const embeddingInput = embeddingLines.join("\n");
  const frameCount = Math.max(
    1,
    Math.round(plate.media.durationSec * plate.media.fps),
  );
  const resolution = parseResolution(plate.media.stitchedResolution);

  return {
    stockClip: {
      sku: plate.sku,
      mmm_stock_clip_id: plate.mmm?.stockClipId ?? null,
      title: plate.title,
      description: plate.description,
      shoot_date: plate.shootDate,
      rig: plate.rig,
      duration_sec: plate.media.durationSec,
      fps: plate.media.fps,
      stitched_resolution: plate.media.stitchedResolution,
      color_pipeline: plate.media.colorPipeline,
      master_format: plate.media.masterFormat,
      camera_originals: plate.media.cameraOriginals,
      source_timecode: plate.media.timecode ?? null,
      shot_type: plate.shotType,
      time_of_day: plate.timeOfDay,
      weather: plate.weather,
      season: plate.season,
      speed_band: plate.speedBand ?? null,
      tags: plate.tags,
      objects: plate.objects,
      location_name: plate.location.name,
      location_city: plate.location.city,
      location_region: plate.location.region,
      location_country: plate.location.country,
      gps: plate.gps ?? null,
      imu: plate.imu,
      stage_compat: plate.stageCompat,
      availability: plate.availability,
      status: plate.status,
      pricing: plate.pricing,
      public_renditions: plate.renditions,
      master_sha256: plate.security.masterSha256,
      watermarked: plate.security.watermarked,
      source,
      source_version: sourceVersion,
      source_metadata: plate,
      search_text: searchTerms.join(" "),
      ingested_at: plate.ingestedAt,
    },
    assets: [
      {
        kind: "poster",
        camera_id: null,
        public_url: plate.renditions.poster,
        mime_type: "image/jpeg",
        width: resolution?.width ?? null,
        height: resolution?.height ?? null,
        duration_sec: null,
        is_public: true,
        source,
        source_version: sourceVersion,
        metadata: {},
      },
      {
        kind: "teaser_preview",
        camera_id: null,
        public_url: plate.renditions.stitchedPreview,
        mime_type: "video/mp4",
        width: resolution?.width ?? null,
        height: resolution?.height ?? null,
        duration_sec: plate.media.durationSec,
        is_public: true,
        source,
        source_version: sourceVersion,
        metadata: { projection: "equirectangular" },
      },
      ...(plate.renditions.stagePreview
        ? [
            {
              kind: "lab_preview",
              camera_id: null,
              public_url: plate.renditions.stagePreview,
              mime_type: "video/mp4",
              width: 2048,
              height: 1024,
              duration_sec: plate.media.durationSec,
              is_public: true,
              source,
              source_version: sourceVersion,
              metadata: {
                projection: "equirectangular",
                coverage: "full-sphere",
                purpose: "led-volume-previs",
              },
            },
          ]
        : []),
      ...CAMERA_IDS.flatMap((cameraId) => {
        const publicUrl = plate.renditions.cameraPreviews[cameraId];
        return publicUrl
          ? [
              {
                kind: "camera_preview",
                camera_id: cameraId,
                public_url: publicUrl,
                mime_type: "video/mp4",
                width: null,
                height: null,
                duration_sec: plate.media.durationSec,
                is_public: true,
                source,
                source_version: sourceVersion,
                metadata: {},
              },
            ]
          : [];
      }),
    ],
    descriptors: descriptorRecords(plate, sourceVersion, source),
    segment: {
      segment_index: 0,
      start_frame: 0,
      end_frame: frameCount,
      start_sec: 0,
      end_sec: plate.media.durationSec,
      description: plate.description,
      labels: uniqueNonEmpty([...plate.tags, ...objectLabels]),
      search_text: searchTerms.join(" "),
      source,
      source_version: sourceVersion,
    },
    clipEmbeddingInput: embeddingInput,
    segmentEmbeddingInput: [
      embeddingInput,
      "Segment: full public preview",
      `Duration: ${plate.media.durationSec} seconds`,
    ].join("\n"),
  };
}

function descriptorRecords(
  plate: Plate,
  sourceVersion: string,
  source: string,
): JsonRecord[] {
  const descriptors: Array<{
    category: string;
    label: string;
    confidence?: number;
    value?: JsonRecord;
  }> = [
    ...plate.tags.map((label) => ({ category: "tag", label })),
    ...plate.objects.map((object) => ({
      category: "object",
      label: object.label,
      confidence: object.confidence,
    })),
    { category: "shot_type", label: plate.shotType },
    { category: "time_of_day", label: plate.timeOfDay },
    { category: "weather", label: plate.weather },
    { category: "season", label: plate.season },
    ...(plate.speedBand
      ? [{ category: "speed_band", label: plate.speedBand }]
      : []),
    ...plate.stageCompat.map((label) => ({
      category: "stage_compat",
      label,
    })),
    {
      category: "location",
      label: plate.location.name,
      value: {
        city: plate.location.city,
        region: plate.location.region,
        country: plate.location.country,
      },
    },
    ...(plate.gps
      ? [
          {
            category: "telemetry",
            label: "gps",
            value: {
              source: plate.gps.source,
              avgSpeedMph: plate.gps.avgSpeedMph,
              maxSpeedMph: plate.gps.maxSpeedMph,
            },
          },
        ]
      : []),
    ...(plate.imu.collected
      ? [
          {
            category: "telemetry",
            label: "imu",
            value: {
              source: plate.imu.source,
              rateHz: plate.imu.rateHz,
            },
          },
        ]
      : []),
  ];

  return descriptors.map((descriptor) => ({
    category: descriptor.category,
    label: descriptor.label,
    normalized_label: normalizeLabel(descriptor.label),
    value: descriptor.value ?? {},
    confidence: descriptor.confidence ?? null,
    source,
    source_version: sourceVersion,
    start_frame: null,
    end_frame: null,
    searchable: true,
  }));
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const unique = new Map<string, string>();
  for (const rawValue of values) {
    const value = rawValue?.trim();
    if (!value) continue;
    const key = normalizeLabel(value);
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()];
}

function normalizeLabel(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function parseResolution(
  value: string,
): { width: number; height: number } | undefined {
  const match = value.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return undefined;
  return { width: Number(match[1]), height: Number(match[2]) };
}
