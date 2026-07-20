# 🪨 Riverbed Grain Size Database

A crowd-sourced, browser-based tool for uploading, geotagging, and exploring riverbed surface grain size data (Wolman pebble counts). Hosted on **GitHub Pages** – no server required to run the site.

---

## Features

| Feature | Details |
|---|---|
| **Interactive map** | Leaflet map showing all samples as coloured markers (blue = fine, red = coarse). Popup for each sample shows metadata + CDF chart. |
| **Submit form** | Click the map or type coordinates; fill in metadata (river, date, landform, surface condition, notes, photo URLs); choose full-phi or half-phi size bins; enter grain counts. |
| **Live CDF preview** | Cumulative distribution (% finer than vs. grain size in mm, log scale) drawn in real time as you enter counts. |
| **Download data** | Download the full database as CSV or JSON. Draw a rectangle on the map to download only samples within an area. |
| **Configurable backend** | Works out-of-the-box with a static `data/samples.json` file. Optionally connect a Google Apps Script backend to save submissions to Google Sheets (which can sync to OneDrive). |

---

## Quick start (view the site)

1. Enable GitHub Pages for this repository:
   `Settings → Pages → Source: Deploy from a branch → Branch: main → / (root)`
   — *or* use the included GitHub Actions workflow (`.github/workflows/pages.yml`).

2. Visit `https://<your-username>.github.io/<repo-name>/`.

3. To explore the demo data: open the **Explore** tab.
   To add a sample: open **Submit Sample**.

---

## Project structure

```
├── index.html              Explore / map view (landing page)
├── submit.html             Submit new sample
├── css/
│   └── style.css           All styles
├── js/
│   ├── config.js           ← Edit this to point at your backend
│   ├── bins.js             Phi size-class definitions & CDF statistics
│   ├── cdf.js              Chart.js CDF rendering
│   ├── data.js             Data load / save (localStorage + API)
│   ├── map-explore.js      Explore-page map logic
│   └── submit.js           Submit-form logic
├── data/
│   └── samples.json        Static sample database (read by the map page)
├── apps-script/
│   └── Code.gs             Google Apps Script backend (optional)
└── .github/
    └── workflows/
        └── pages.yml       Automatic GitHub Pages deployment
```

---

## Setting up data persistence (Google Apps Script)

By default the site is "read-only": the map displays whatever is in
`data/samples.json`, and any sample you submit is saved only in your
browser's `localStorage`.

To enable crowd-sourced data collection with persistent storage:

### 1 – Create a Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet.
2. Copy the **Spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`

### 2 – Deploy the Apps Script

1. Open [Google Apps Script](https://script.google.com) → **New project**.
2. Replace the default code with the contents of `apps-script/Code.gs`.
3. Set `SHEET_ID` at the top of the script to your spreadsheet's ID.
4. Click **Deploy → New Deployment**:
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy** and **copy the Web App URL**.

### 3 – Configure the frontend

Open `js/config.js` and set `API_URL` to your Web App URL:

```js
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
  // ...
};
```

Commit and push. The site will now POST new samples to your Google Sheet and
read all samples from the API on page load.

### 4 – Sync to OneDrive (optional)

- Install [Google Drive for Desktop](https://www.google.com/drive/download/).
- Place the Google Sheet in a folder that is synced to your university OneDrive.
- Every submission will be mirrored to OneDrive automatically.

---

## Adding samples manually to `data/samples.json`

You can also add samples by editing `data/samples.json` directly. Each entry follows this schema:

```jsonc
{
  "id":               "sample-001",
  "timestamp":        "2024-04-10T09:15:00Z",
  "collector":        "Jane Smith",
  "institution":      "University of Bristol",
  "river_name":       "River Wye",
  "date_collected":   "2024-04-10",
  "landform":         "bar_top",
  "surface_condition":"lightly_imbricated",
  "phi_interval":     "full",
  "location": {
    "lat": 51.8122,
    "lng": -2.7193,
    "description": "Downstream of Monmouth, left bank bar"
  },
  "counts": {
    "finest":   0,
    "1.000":    2,
    "2.000":    8,
    "4.000":   22,
    "8.000":   41,
    "16.000":  38,
    "32.000":  24,
    "64.000":  12,
    "128.000":  3,
    "256.000":  0,
    "coarsest": 0
  },
  "notes": "Low flow; bar exposed. Surface moderately armoured.",
  "photo_urls": []
}
```

**Landform values:** `pool`, `riffle`, `bar_head`, `bar_top`, `bar_tail`, `step`, `glide`, `other`

**Surface condition values:** `underwater`, `lightly_imbricated`, `heavily_imbricated`, `recently_reworked`, `other`

**Full-phi bin keys** (11 bins):

| Key | Size range | Phi range |
|---|---|---|
| `finest` | < 0.5 mm | phi > 1 |
| `1.000` | 0.5 – 1 mm | 0 – 1 phi |
| `2.000` | 1 – 2 mm | -1 – 0 phi |
| `4.000` | 2 – 4 mm | -2 – -1 phi |
| `8.000` | 4 – 8 mm | -3 – -2 phi |
| `16.000` | 8 – 16 mm | -4 – -3 phi |
| `32.000` | 16 – 32 mm | -5 – -4 phi |
| `64.000` | 32 – 64 mm | -6 – -5 phi |
| `128.000` | 64 – 128 mm | -7 – -6 phi |
| `256.000` | 128 – 256 mm | -8 – -7 phi |
| `coarsest` | > 256 mm | phi < -8 |

For **half-phi** samples add the intermediate keys:
`0.7071`, `1.4142`, `2.8284`, `5.6569`, `11.3137`, `22.6274`, `45.2548`, `90.5097`, `181.019`

---

## Download formats

### CSV
One row per sample. Columns: all metadata fields plus computed statistics
(D10, D50, D84 in mm) and total clast count.

### JSON
Complete raw data including the full `counts` object for every sample.

---

## Dependencies (loaded from CDN)

| Library | Version | Purpose |
|---|---|---|
| [Bootstrap](https://getbootstrap.com) | 5.3.2 | Responsive UI |
| [Leaflet](https://leafletjs.com) | 1.9.4 | Interactive maps |
| [Chart.js](https://www.chartjs.org) | 4.4.2 | CDF charts |

No build step or Node.js required — the site is pure HTML/CSS/JavaScript.

---

## Licence

Sample data contributed by users is shared under
[Creative Commons BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Website code is MIT licensed.
