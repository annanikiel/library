# Library

A personal library of content worth coming back to. The content lives as JSON in
this repo (`data/*.json`); the app is a single static page that reads it, so
there is no build step, no server and nothing to deploy beyond the files
themselves.

- **Yoga** — YouTube classes, tagged by style, time of day and length.
- **Meditation** — same idea, with `type` instead of `style`.

## Running it

```bash
python3 -m http.server      # then open http://localhost:8000
```

A plain `open index.html` will not work: browsers block `fetch()` of local files
from `file://`, so the JSON never loads. The app says so if that happens.

To put it online, enable GitHub Pages (Settings → Pages → deploy from branch
`main`, folder `/`). It becomes `https://annanikiel.github.io/library/`, which
is the version worth saving to your phone's home screen.

## Adding something

Two ways, both ending in a commit to `data/*.json`:

1. **From the app** — hit **+ Add**, fill the form, then **Copy whole file** and
   **Open on GitHub ↗**. Select all in the GitHub editor, paste, commit. The
   form suggests tag values you have already used, which keeps them tidy.
2. **By hand** — edit `data/yoga.json` on GitHub and add an object to the array.

## Shape of an entry

Only `title` and `url` are really required; everything else is optional and the
app simply omits what is missing.

```json
{
  "title": "Slow flow for tight shoulders",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "channel": "Yoga With Someone",
  "durationMin": 25,
  "style": "vinyasa",
  "timeOfDay": ["morning"],
  "tags": ["shoulders", "gentle"],
  "notes": "Good on a desk-heavy day.",
  "favourite": true,
  "added": "2026-08-30"
}
```

| Field | Notes |
| --- | --- |
| `title`, `url` | `url` drives the thumbnail — any YouTube link shape works (`watch?v=`, `youtu.be`, `/shorts/`). |
| `durationMin` | A number. The app buckets it into Under 15 / 15–30 / 30–45 / 45–60 / 60+. |
| `style` / `type` | One value. Yoga uses `style`, meditation uses `type`. |
| `timeOfDay`, `tags` | Arrays — as many as you like. |
| `favourite` | `true` shows a ★ and enables the favourites filter. |
| `added` | `YYYY-MM-DD`, used by the "Recently added" sort. |

**Filter values are not fixed.** Facet options are derived from whatever is in
the JSON, so writing `"style": "kundalini"` makes a Kundalini chip appear. The
`order` lists in `assets/app.js` only decide the order of the values already
known; anything new is appended alphabetically.

Filters combine as OR within a row and AND across rows — *(yin or restorative)
and evening and under 30 min*. The current tab, search and filters live in the
URL, so any view can be bookmarked or sent to someone.

## Adding another tab

Add a JSON file under `data/`, then an entry to `COLLECTIONS` at the top of
`assets/app.js`:

```js
{
  id: 'recipes',
  label: 'Recipes',
  file: 'data/recipes.json',
  blurb: 'Things worth cooking twice.',
  facets: [
    { key: 'cuisine', label: 'Cuisine' },
    { key: 'timeOfDay', label: 'Meal', list: true },
    { key: '_duration', label: 'Time' },
    { key: 'tags', label: 'Tags', list: true },
  ],
}
```

`list: true` means the field holds an array. `_duration` is the special derived
facet that buckets `durationMin`. Nothing else needs changing — tabs, filters,
sorting and the add form all read from that config.

## Files

```
index.html          markup
assets/styles.css   styling, light + dark
assets/app.js       collection config + all behaviour
data/*.json         the content itself
```

The seeded rows are placeholders marked `Example —`; delete them once you have
real entries in.
