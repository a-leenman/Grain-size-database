# 🪨 Riverbed Grain Size Database

A crowd-sourced, browser-based tool for uploading, geotagging, and exploring riverbed surface grain size data (Wolman pebble counts). Hosted on **GitHub Pages** – no server required to run the site.

---

## Features

| Feature | Details |
|---|---|
| **Interactive map** | Leaflet map showing all samples as coloured markers (blue = fine, red = coarse). Popup for each sample shows metadata + CDF chart. Esri World Imagery is used with multi-host fallback, then OpenStreetMap if imagery tiles fail. |
| **Submit form** | Click the map or type coordinates; fill in metadata (river, date, landform, surface condition, paper DOI, notes, photo URLs), and choose whether your name+institution can be publicly acknowledged; choose full-phi or half-phi bins plus a minimum measured opening size (2/4/8 mm); enter grain counts and optional percentages (auto-filled from counts if left blank). |
| **Contributors page** | Lists contributor names, institutions, and total contributed sample counts (grouped by contributor email) only for submissions where contributors opted in to public acknowledgement. |
| **QC status** | Samples can be marked as QC-checked by an admin; QC status is shown in map popups and included in exports. |
| **Live CDF preview** | Cumulative distribution (% finer than vs. grain size in mm, log scale) drawn in real time as you enter counts. |
| **Download data** | Download the full database as CSV or JSON. Every dataset download also includes a bibliography file for DOI-linked studies (BibTeX / Harvard / Chicago), including area-selected downloads from drawn rectangles. |
| **Configurable backend** | Works out-of-the-box with a static `data/samples.json` file. Optionally connect a Google Apps Script backend to save submissions to Google Sheets. |

---

## Quick start (view the site)

1. Enable GitHub Pages for this repository using GitHub Actions:
   `Settings → Pages → Build and deployment → Source: GitHub Actions`
   (uses `.github/workflows/pages.yml`).

2. Visit `https://<your-username>.github.io/<repo-name>/`.

3. To explore the demo data: open the **Explore** tab.
   To add a sample: open **Submit Sample**.

---

## Project structure

```
├── index.html              Explore / map view (landing page)
├── submit.html             Submit new sample
├── contributors.html       Public contributor acknowledgements
├── css/
│   └── style.css           All styles
├── js/
│   ├── config.js           ← Edit this to point at your backend
│   ├── bins.js             Phi size-class definitions & CDF statistics
│   ├── cdf.js              Chart.js CDF rendering
│   ├── data.js             Data load / save (localStorage + API)
│   ├── map-explore.js      Explore-page map logic
│   ├── submit.js           Submit-form logic
│   ├── contributors.js     Contributors page logic
│   └── welcome.js          Opening welcome modal
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

By default the site is in demo mode: the map loads `data/samples.json`, and
new submissions are saved in the browser's `localStorage` and merged into the
displayed dataset for that browser.

To enable crowd-sourced data collection with persistent storage:

### 1 – Create a Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet.
2. Copy the **Spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`

### 2 – Deploy the Apps Script

1. Open [Google Apps Script](https://script.google.com) → **New project**.
2. Replace the default code with the contents of `apps-script/Code.gs`.
3. Set `SHEET_ID` at the top of the script to your spreadsheet's ID.
4. Set `ADMIN_QC_TOKEN` in `Code.gs` for admin QC sign-in.
5. Click **Deploy → New Deployment**:
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy** and **copy the Web App URL**.

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

### 4 – OneDrive copy (optional)

- Open the Google Sheet used by Apps Script.
- Use **File → Download → Microsoft Excel (.xlsx)** to export a snapshot.
- Upload that `.xlsx` file to OneDrive when you want to share/update a copy there.

---

## Adding samples manually to `data/samples.json`

You can also add samples by editing `data/samples.json` directly. Each entry follows this schema:

```jsonc
{
  "id":               "sample-001",
  "timestamp":        "2024-04-10T09:15:00Z",
  "collector":        "Jane Smith",
  "institution":      "University of Bristol",
  "contributor_email":"jane.smith@example.edu",
  "contributor_id":   "contrib-xxxxxxxx",
  "allow_public_acknowledgement": true,
  "river_name":       "River Wye",
  "paper_doi":        "10.1000/xyz123",
  "date_collected":   "2024-04-10",
  "landform":         "bar_top",
  "surface_condition":"lightly_imbricated",
  "min_opening_mm":   2,
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
  "percentages": {
    "finest": 0,
    "4.000": 22.4
  },
  "notes": "Low flow; bar exposed. Surface moderately armoured.",
  "photo_urls": [],
  "qc_checked":       false,
  "qc_checked_at":    "",
  "qc_checked_by":    ""
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
`0.707`, `1.414`, `2.828`, `5.657`, `11.314`, `22.627`, `45.255`, `90.510`, `181.019`

---

## Download formats

### CSV
One row per sample. Columns: all metadata fields plus computed statistics
(D10, D50, D84 in mm), QC fields, minimum opening size, and total clast count.

### JSON
Complete raw data including the full `counts` object for every sample.

Contributor emails are used to derive an internal contributor ID for counting,
but contributor emails are not included in public data exports.

### Bibliography export
When downloading any dataset (all CSV, all JSON, selected-area CSV, or
selected-area JSON), the app also exports a bibliography compiled from unique
`paper_doi` values in the downloaded samples. Users can choose **BibTeX**,
**Harvard**, or **Chicago** style before downloading.

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
