# Tree Hierarchy Chart

A collapsible, pannable/zoomable tree diagram for Power BI, for visualizing
hierarchical data (org charts, category trees, product hierarchies, etc.),
with node color and size optionally driven by a measure.

## Features

- **Hierarchy levels** — drop 1 or more dimension columns into the
  Hierarchy data role to define parent/child levels.
- **Multi-measure selector** — bind up to 3 measures; switch between them
  live via toolbar buttons. Node size, color, and the "% of parent" label
  all update to the selected measure.
- **Expand/collapse** — click a node to expand/collapse its children, or
  use the per-level "expand to level N" / "collapse all" toolbar buttons.
- **Search** — type in the search box to find matching nodes by label;
  matches auto-expand into view, with prev/next navigation between
  matches and cross-filtering of other visuals on the current match.
- **Saved views** — save the current expand-state, search, zoom, and
  active measure as a named view, and switch between saved views from the
  toolbar dropdown.
- **Theme sync** — per-level colors default to the report's own theme
  palette, and can be overridden per level in the formatting pane.
- **Total/Subtotal aware** — node values respect Power BI's built-in
  Total/Subtotal aggregation for the selected measure.

## Using the visual

1. Import the `.pbiviz` package into Power BI Desktop (Insert → More
   visuals → Import a visual from a file) or install it from AppSource.
2. Drag one or more columns into **Hierarchy** to define the tree levels
   (in order, from root to leaf).
3. Optionally drag up to 3 measures into **Values** to size/color nodes
   and enable the measure-selector buttons.
4. Use the toolbar to expand/collapse levels, search, switch measures, or
   save/restore views.

## Privacy & licensing

See [PRIVACY.md](PRIVACY.md) and [EULA.md](EULA.md).

## Support

For bugs or feature requests, please open an issue on this repository.
