# Building the sample .pbix for AppSource submission

AppSource requires a sample `.pbix` that works fully offline. Power BI
Desktop is the only tool that can produce a `.pbix`, so these steps are
manual, but quick (~5 minutes) using the dummy dataset already prepared
here: [`tree_hierarchy_sample_data.csv`](tree_hierarchy_sample_data.csv)
(28 rows: Region → Country → City → Store, with Revenue, Cost, and
Headcount measures).

## Steps

1. Open Power BI Desktop → **Get Data** → **Text/CSV** → select
   `sample/tree_hierarchy_sample_data.csv` → **Load**.
2. **Insert** → **More visuals** → **Import a visual from a file** →
   select the latest `.pbiviz` from
   [`dist/`](../dist) → add it to the canvas.
3. Build the hierarchy: drag **Region**, **Country**, **City**, **Store**
   (in that order) into the visual's **Hierarchy** data role.
4. Bind measures: drag **Revenue**, **Cost**, and **Headcount** into the
   visual's **Values** data role (all 3 — this exercises the multi-measure
   selector, capped at 3).
5. Exercise the features so the sample actually demonstrates them:
   - Expand a couple of branches, collapse others.
   - Type a query into the search box (e.g. "Tokyo" or "Downtown") and
     use the prev/next match navigation.
   - Switch between the Revenue / Cost / Headcount toolbar buttons.
   - Save two views from the toolbar, e.g. **"Revenue Only"** (with only
     Revenue selected) and **"Revenue & Cost"** (with Cost also active),
     then confirm switching between them restores the right state.
6. Resize the visual to a reasonable report-page size, add a text box
   title if you like (e.g. "Tree Hierarchy Chart — Sample").
7. **File** → **Save As** → save as
   `sample/TreeHierarchyChart-Sample.pbix` in this repo.
8. Confirm it opens correctly with **no live data connections** — Get
   Data was a static CSV import, so this should already be true; just
   avoid adding any DirectQuery/live connection sources.

Once saved, commit and push it:

```powershell
cd "C:\Users\pathakso\Documents\MyProjects\PowerBI\Custom Visuals\treeHierarchyChart"
git add sample/TreeHierarchyChart-Sample.pbix
git commit -m "Add sample .pbix for AppSource submission"
git push
```
