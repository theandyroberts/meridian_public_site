# Private screenplay scene import

The Plate Lab never asks the creator to upload a screenplay. The creator runs
the extraction prompt in an AI tool they choose, reviews the resulting JSON
locally, and imports only the structured scene briefs they approve.

## Contract

```json
{
  "schema_version": "the-plate-lab.scene-import.v1",
  "scenes": [
    {
      "scene_name": "Marta escapes the estate",
      "script_scene_number": "41",
      "script_pages": "42",
      "description": "Interior driving plate on a narrow private road through dense New England woods at midnight. Cold mist, no traffic, with a carved wooden elephant and guard gate visible from the driver-side window.",
      "search_keywords": [
        "private wooded road",
        "New England",
        "midnight",
        "cold mist",
        "no traffic",
        "guard gate",
        "driver-side view"
      ]
    }
  ]
}
```

The canonical prompt is exported as `SCENE_EXTRACTION_PROMPT` from
`web/lib/sceneImport.ts` and displayed in the project workflow. The browser:

1. Reads files locally with `File.text()`.
2. Rejects malformed, oversized, unsupported, or out-of-contract content.
3. Shows every field in an editable review list.
4. Submits only the canonical JSON stored in the hidden form payload after the
   creator confirms the import.

There is no screenplay file input, upload endpoint, storage bucket, or
server-side screenplay parser.

## Limits

- Schema version must be `the-plate-lab.scene-import.v1`.
- Maximum file size: 1 MB.
- Maximum scenes per file: 250.
- Every scene requires a name, a plate description, and 3–24 reviewed search
  keywords.
- Unknown fields are rejected so private script excerpts cannot be silently
  accepted and discarded.
