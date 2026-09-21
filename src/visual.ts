"use strict";

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import { VisualFormattingSettingsModel } from "./settings";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataViewMatrixNode = powerbi.DataViewMatrixNode;
import DataViewHierarchyLevel = powerbi.DataViewHierarchyLevel;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import VisualObjectInstancesToPersist = powerbi.VisualObjectInstancesToPersist;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

interface TreeDatum {
    name: string;
    value: number | null;
    path: string;
    level: number;
    selectionId: ISelectionId | null;
    children?: TreeDatum[];
}

interface SavedView {
    name: string;
    collapsedPaths: string[];
    searchQuery: string;
    zoom: { x: number; y: number; k: number };
    measureQueryName?: string;
}

export class Visual implements IVisual {
    private static readonly MAX_SAFE_LEVELS = 8;
    private static readonly LEVEL_COLORS: readonly string[] = d3.schemeTableau10;
    private static readonly ROOT_SUMMARY_COLOR = "#323130";
    private events: IVisualEventService;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private target: HTMLElement;
    private toolbar: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private levelButtonsContainer: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private measureButtonsContainer: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private searchContainer: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private searchInput: d3.Selection<HTMLInputElement, unknown, null, undefined>;
    private searchStatus: d3.Selection<HTMLSpanElement, unknown, null, undefined>;
    private viewsContainer: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private viewsSelect: d3.Selection<HTMLSelectElement, unknown, null, undefined>;
    private saveNameInput: d3.Selection<HTMLInputElement, unknown, null, undefined>;
    private totalLabel: d3.Selection<HTMLSpanElement, unknown, null, undefined>;
    private warningBanner: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private linkLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
    private nodeLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
    private zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>;

    private rowLevels: DataViewHierarchyLevel[] = [];
    private collapsedPaths: Set<string> = new Set();
    private hasCentered: boolean = false;
    private lastOrientation: string | null = null;
    private themeColors: string[] = [...Visual.LEVEL_COLORS];
    private savedViews: SavedView[] = [];

    private lastTreeData: TreeDatum | null = null;
    private lastWidth: number = 0;
    private lastHeight: number = 0;
    private lastRoot: DataViewMatrixNode | null = null;
    private lastValueSources: DataViewMetadataColumn[] = [];
    private selectedMeasureIndex: number = 0;

    private searchQuery: string = "";
    private searchMatchList: string[] = [];
    private searchMatchIndex: number = -1;
    private searchMatchPaths: Set<string> = new Set();
    private lastNodePositions: Map<string, { x: number; y: number }> = new Map();

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();
        this.target = options.element;

        this.selectionManager.registerOnSelectCallback(() => this.updateSelectionStyles());

        d3.select(this.target).style("position", "relative");

        this.toolbar = d3.select(this.target)
            .append("div")
            .attr("class", "tree-toolbar");

        this.toolbar.append("button")
            .attr("class", "tree-toolbar-button")
            .text("Expand all")
            .on("click", () => {
                this.collapsedPaths.clear();
                if (this.lastTreeData) {
                    this.hasCentered = false;
                    this.renderTree(this.lastTreeData, this.lastWidth, this.lastHeight);
                }
            });

        this.toolbar.append("button")
            .attr("class", "tree-toolbar-button")
            .text("Collapse all")
            .on("click", () => {
                if (this.lastTreeData) {
                    this.collapsedPaths.clear();
                    this.collectBranchPaths(this.lastTreeData, this.collapsedPaths);
                    this.hasCentered = false;
                    this.renderTree(this.lastTreeData, this.lastWidth, this.lastHeight);
                }
            });

        this.levelButtonsContainer = this.toolbar.append("div")
            .attr("class", "tree-toolbar-levels");

        this.measureButtonsContainer = this.toolbar.append("div")
            .attr("class", "tree-toolbar-measures");

        this.searchContainer = this.toolbar.append("div")
            .attr("class", "tree-toolbar-search");

        this.searchInput = this.searchContainer.append("input")
            .attr("type", "text")
            .attr("class", "tree-search-input")
            .attr("placeholder", "Search nodes…")
            .on("input", (event: Event) => {
                this.runSearch((event.target as HTMLInputElement).value);
            })
            .on("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    this.stepSearchMatch(event.shiftKey ? -1 : 1);
                }
            });

        this.searchContainer.append("button")
            .attr("class", "tree-toolbar-button tree-search-nav")
            .attr("title", "Previous match")
            .text("‹")
            .on("click", () => this.stepSearchMatch(-1));

        this.searchContainer.append("button")
            .attr("class", "tree-toolbar-button tree-search-nav")
            .attr("title", "Next match")
            .text("›")
            .on("click", () => this.stepSearchMatch(1));

        this.searchStatus = this.searchContainer.append("span")
            .attr("class", "tree-search-status");

        this.viewsContainer = this.toolbar.append("div")
            .attr("class", "tree-toolbar-views");

        this.viewsSelect = this.viewsContainer.append("select")
            .attr("class", "tree-views-select")
            .on("change", () => {
                const idx = Number((this.viewsSelect.node() as HTMLSelectElement).value);
                const view = this.savedViews[idx];
                if (view) {
                    this.restoreView(view);
                }
            });

        this.saveNameInput = this.viewsContainer.append("input")
            .attr("type", "text")
            .attr("class", "tree-view-name-input")
            .attr("placeholder", "View name")
            .style("display", "none")
            .on("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    this.commitSaveView();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    this.cancelSaveView();
                }
            });

        this.viewsContainer.append("button")
            .attr("class", "tree-toolbar-button")
            .attr("title", "Save the current expand/zoom/search state as a named view")
            .text("Save view")
            .on("click", () => {
                const inputNode = this.saveNameInput.node() as HTMLInputElement;
                if (inputNode.style.display === "none") {
                    this.saveNameInput
                        .style("display", null)
                        .property("value", `View ${this.savedViews.length + 1}`);
                    inputNode.focus();
                    inputNode.select();
                } else {
                    this.commitSaveView();
                }
            });

        this.viewsContainer.append("button")
            .attr("class", "tree-toolbar-button")
            .attr("title", "Delete the selected view")
            .text("✕")
            .on("click", () => this.deleteSelectedView());

        this.totalLabel = this.toolbar.append("span")
            .attr("class", "tree-toolbar-total");

        this.warningBanner = d3.select(this.target)
            .append("div")
            .attr("class", "tree-warning-banner")
            .style("display", "none");

        this.svg = d3.select(this.target)
            .append("svg")
            .attr("class", "tree-hierarchy-chart")
            .attr("width", "100%")
            .attr("height", "100%");

        this.container = this.svg.append("g").attr("class", "zoom-container");
        this.linkLayer = this.container.append("g").attr("class", "links");
        this.nodeLayer = this.container.append("g").attr("class", "nodes");

        this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 4])
            .filter((event: Event) => !(event.target as Element).closest(".node"))
            .on("zoom", (event) => {
                this.container.attr("transform", event.transform.toString());
            });

        this.svg.call(this.zoomBehavior);

        this.svg.on("click", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.updateSelectionStyles());
            }
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);

        try {
            const dataView = options.dataViews && options.dataViews[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.refreshThemeColors();
            this.loadSavedViews(dataView);

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("viewBox", `0 0 ${width} ${height}`);

            const root = dataView && dataView.matrix && dataView.matrix.rows && dataView.matrix.rows.root;
            if (!root || !root.children || root.children.length === 0) {
                this.linkLayer.selectAll("*").remove();
                this.nodeLayer.selectAll("*").remove();
                this.measureButtonsContainer.selectAll("*").remove();
                this.lastTreeData = null;
                this.lastRoot = null;
                this.lastValueSources = [];
                this.updateTotalLabel();
                this.events.renderingFinished(options);
                return;
            }

            this.rowLevels = dataView.matrix.rows.levels;
            this.renderLevelButtons(this.rowLevels.length);
            this.updateLevelWarning(this.rowLevels.length);

            const valueSources = dataView.matrix.valueSources || [];
            this.lastRoot = root;
            this.lastValueSources = valueSources;
            this.selectedMeasureIndex = this.resolveSelectedMeasureIndex(dataView, valueSources);
            this.renderMeasureButtons(valueSources, this.selectedMeasureIndex);

            const measureIndex = valueSources.length > 0 ? this.selectedMeasureIndex : null;
            const treeData = this.buildTreeData(root, measureIndex);

            this.lastTreeData = treeData;
            this.lastWidth = width;
            this.lastHeight = height;

            this.renderTree(treeData, width, height);
            this.updateSearchStatus();
            this.updateTotalLabel();

            this.events.renderingFinished(options);
        }
        catch (error) {
            console.error("Error in update method", error);
            this.events.renderingFailed(options, String(error));
        }
    }

    private buildTreeData(root: DataViewMatrixNode, measureIndex: number | null): TreeDatum {
        const allChildren = root.children || [];
        const grandTotalNode = allChildren.find(c => c.isSubtotal);
        const realChildren = allChildren.filter(c => !c.isSubtotal);

        const topLevelTrees = realChildren.map((child, index) =>
            this.transformMatrixToTree(child, measureIndex, "All", `${index}`, 0));

        if (topLevelTrees.length === 1 && !grandTotalNode) {
            return topLevelTrees[0];
        }

        const hostTotal = measureIndex !== null ? this.extractSubtotalValue(grandTotalNode, measureIndex) : null;

        return {
            name: "All",
            value: hostTotal ?? (measureIndex !== null ? d3.sum(topLevelTrees, t => t.value ?? 0) : null),
            path: "__root__",
            level: -1,
            selectionId: null,
            children: topLevelTrees
        };
    }

    // Prefer the host-aggregated subtotal (correct for any aggregation type -
    // sum, average, min/max, distinct count, ...) over summing children
    // ourselves, which is only ever correct for additive (sum) measures.
    private extractSubtotalValue(node: DataViewMatrixNode | undefined, measureIndex: number): number | null {
        if (!node || !node.values) {
            return null;
        }
        const valueNode = node.values[measureIndex];
        if (!valueNode || valueNode.value == null) {
            return null;
        }
        const raw = valueNode.value;
        return typeof raw === "number" ? raw : Number(raw);
    }

    private resolveSelectedMeasureIndex(dataView: powerbi.DataView, valueSources: DataViewMetadataColumn[]): number {
        if (valueSources.length === 0) {
            return 0;
        }

        const objects = dataView.metadata && dataView.metadata.objects;
        const persisted = objects && (objects as any).state && (objects as any).state.selectedMeasure;

        if (typeof persisted === "string") {
            const index = valueSources.findIndex(source => source.queryName === persisted);
            if (index >= 0) {
                return index;
            }
        }

        return Math.min(this.selectedMeasureIndex, valueSources.length - 1);
    }

    private transformMatrixToTree(node: DataViewMatrixNode, measureIndex: number | null, fallbackName: string, path: string, level: number): TreeDatum {
        const label = node.value != null
            ? String(node.value)
            : (node.levelValues && node.levelValues[0] && node.levelValues[0].value != null
                ? String(node.levelValues[0].value)
                : fallbackName);

        const allChildren = node.children || [];
        const subtotalChild = allChildren.find(c => c.isSubtotal);
        const realChildren = allChildren.filter(c => !c.isSubtotal);
        const hasChildren = realChildren.length > 0;

        let value: number | null = null;
        if (measureIndex !== null && !hasChildren && node.values) {
            const valueNode = node.values[measureIndex];
            if (valueNode) {
                const raw = valueNode.value;
                value = typeof raw === "number" ? raw : (raw != null ? Number(raw) : null);
            }
        }

        const selectionId = this.host.createSelectionIdBuilder()
            .withMatrixNode(node, this.rowLevels)
            .createSelectionId();

        const datum: TreeDatum = {
            name: label,
            value,
            path,
            level,
            selectionId,
            children: undefined
        };

        if (hasChildren) {
            datum.children = realChildren.map((child, index) =>
                this.transformMatrixToTree(child, measureIndex, label, `${path}/${index}:${label}`, level + 1));
            if (measureIndex !== null) {
                const hostSubtotal = this.extractSubtotalValue(subtotalChild, measureIndex);
                datum.value = hostSubtotal ?? d3.sum(datum.children, c => c.value ?? 0);
            }
        }

        return datum;
    }

    private collectMatchingNodes(node: TreeDatum, query: string, into: TreeDatum[]): void {
        if (node.name.toLowerCase().includes(query)) {
            into.push(node);
        }
        (node.children || []).forEach(child => this.collectMatchingNodes(child, query, into));
    }

    // Drives the report-wide cross-filter from the current search match set:
    // selects every matched node's selectionId (replacing prior selection), or
    // clears the filter entirely when there are no matches / no active query.
    private applySearchSelection(matchedNodes: TreeDatum[]): void {
        const ids = matchedNodes
            .map(n => n.selectionId)
            .filter((id): id is ISelectionId => id !== null);

        if (ids.length > 0) {
            this.selectionManager.select(ids, false).then(() => this.updateSelectionStyles());
        } else {
            this.selectionManager.clear().then(() => this.updateSelectionStyles());
        }
    }

    // Walks down from `node` looking for `targetPath`, recording every ancestor
    // path along the way so the caller can un-collapse just that one branch.
    private collectAncestorPaths(node: TreeDatum, targetPath: string, into: string[]): boolean {
        if (node.path === targetPath) {
            return true;
        }
        for (const child of node.children || []) {
            if (this.collectAncestorPaths(child, targetPath, into)) {
                into.push(node.path);
                return true;
            }
        }
        return false;
    }

    private runSearch(rawQuery: string): void {
        try {
            const query = rawQuery.trim().toLowerCase();
            this.searchQuery = query;
            this.searchMatchPaths.clear();
            this.searchMatchList = [];
            this.searchMatchIndex = -1;

            if (this.lastTreeData && query) {
                const matchedNodes: TreeDatum[] = [];
                this.collectMatchingNodes(this.lastTreeData, query, matchedNodes);
                this.searchMatchList = matchedNodes.map(n => n.path);
                this.searchMatchList.forEach(path => this.searchMatchPaths.add(path));

                this.searchMatchList.forEach(path => this.expandAncestorsOf(path));

                this.searchMatchIndex = matchedNodes.length ? 0 : -1;
                this.applySearchSelection(matchedNodes);
            } else {
                this.selectionManager.clear().then(() => this.updateSelectionStyles());
            }

            if (this.lastTreeData) {
                this.renderTree(this.lastTreeData, this.lastWidth, this.lastHeight);
            }

            if (this.searchMatchIndex >= 0) {
                this.centerOnPath(this.searchMatchList[this.searchMatchIndex]);
            }

            this.updateSearchStatus();
        }
        catch (error) {
            console.error("Error in runSearch", error);
            this.searchStatus.text(`Error: ${(error as Error).message || error}`);
        }
    }

    /**
     * Removes every ancestor of `path` from `collapsedPaths`.
     * Returns true if anything was actually removed, meaning the tree
     * must be re-rendered before that node's position is trustworthy.
     */
    private expandAncestorsOf(path: string): boolean {
        if (!this.lastTreeData) {
            return false;
        }
        const ancestors: string[] = [];
        this.collectAncestorPaths(this.lastTreeData, path, ancestors);
        let changed = false;
        ancestors.forEach(a => {
            if (this.collapsedPaths.delete(a)) {
                changed = true;
            }
        });
        return changed;
    }

    private stepSearchMatch(delta: number): void {
        try {
            if (this.searchMatchList.length === 0) {
                return;
            }
            this.searchMatchIndex = (this.searchMatchIndex + delta + this.searchMatchList.length) % this.searchMatchList.length;
            const targetPath = this.searchMatchList[this.searchMatchIndex];

            if (this.expandAncestorsOf(targetPath) && this.lastTreeData) {
                this.renderTree(this.lastTreeData, this.lastWidth, this.lastHeight);
            }
            else {
                this.updateCurrentMatchHighlight();
            }

            this.centerOnPath(targetPath);
            this.updateSearchStatus();
        }
        catch (error) {
            console.error("Error in stepSearchMatch", error);
        }
    }

    private updateCurrentMatchHighlight(): void {
        const currentMatchPath = this.searchMatchIndex >= 0 ? this.searchMatchList[this.searchMatchIndex] : null;
        this.nodeLayer.selectAll<SVGGElement, any>("g.node")
            .classed("search-current", (d: any) => currentMatchPath !== null && d.data.path === currentMatchPath);
    }

    private updateSearchStatus(): void {
        if (!this.searchQuery) {
            this.searchStatus.text("");
        } else if (this.searchMatchList.length === 0) {
            this.searchStatus.text("No matches");
        } else {
            this.searchStatus.text(`${this.searchMatchIndex + 1} / ${this.searchMatchList.length}`);
        }
    }

    // Pans to center `path` at the current zoom scale using a plain linear
    // tween. Deliberately avoids driving this through zoomBehavior.transform
    // inside a d3 transition: d3-zoom's default transition interpolator
    // (interpolateZoom) zooms out and back in mid-flight for long pans,
    // which reads as the view "shrinking" for an instant - a real but
    // transient effect, not a lasting bug. A direct translate-only tween at
    // constant scale can't produce that dip.
    private centerOnPath(path: string): boolean {
        const pos = this.lastNodePositions.get(path);
        const svgNode = this.svg.node();
        if (!pos || !svgNode) {
            return false;
        }
        const current = d3.zoomTransform(svgNode);
        const targetX = this.lastWidth / 2 - pos.x * current.k;
        const targetY = this.lastHeight / 2 - pos.y * current.k;
        const interpolateX = d3.interpolateNumber(current.x, targetX);
        const interpolateY = d3.interpolateNumber(current.y, targetY);

        this.svg.transition().duration(300)
            .tween("centerPan", () => (t: number) => {
                this.svg.call(
                    this.zoomBehavior.transform,
                    d3.zoomIdentity.translate(interpolateX(t), interpolateY(t)).scale(current.k)
                );
            });
        return true;
    }

    private collectBranchPaths(node: TreeDatum, into: Set<string>): void {
        if (!node.children || node.children.length === 0) {
            return;
        }
        if (node.selectionId !== null) {
            into.add(node.path);
        }
        node.children.forEach(child => this.collectBranchPaths(child, into));
    }

    private collapseToLevel(node: TreeDatum, depth: number, targetLevel: number, into: Set<string>): void {
        if (!node.children || node.children.length === 0) {
            return;
        }

        const currentDepth = node.selectionId !== null ? depth + 1 : depth;

        if (node.selectionId !== null && currentDepth >= targetLevel) {
            into.add(node.path);
            return;
        }

        node.children.forEach(child => this.collapseToLevel(child, currentDepth, targetLevel, into));
    }

    private renderLevelButtons(levelCount: number): void {
        const levels = levelCount > 1 ? d3.range(1, levelCount + 1) : [];

        const buttons = this.levelButtonsContainer.selectAll<HTMLButtonElement, number>("button")
            .data(levels, (d: number) => String(d));

        buttons.exit().remove();

        buttons.enter()
            .append("button")
            .attr("class", "tree-toolbar-button")
            .merge(buttons as any)
            .text((d: number) => `Level ${d}`)
            .on("click", (event: MouseEvent, level: number) => {
                if (!this.lastTreeData) {
                    return;
                }
                this.collapsedPaths.clear();
                this.collapseToLevel(this.lastTreeData, 0, level, this.collapsedPaths);
                this.hasCentered = false;
                this.renderTree(this.lastTreeData, this.lastWidth, this.lastHeight);
            });
    }

    private renderMeasureButtons(valueSources: DataViewMetadataColumn[], selectedIndex: number): void {
        const measures = valueSources.length > 1 ? valueSources : [];

        const buttons = this.measureButtonsContainer.selectAll<HTMLButtonElement, DataViewMetadataColumn>("button")
            .data(measures, (d: DataViewMetadataColumn) => d.queryName || d.displayName);

        buttons.exit().remove();

        buttons.enter()
            .append("button")
            .attr("class", "tree-toolbar-button")
            .merge(buttons as any)
            .text((d: DataViewMetadataColumn) => d.displayName)
            .classed("tree-toolbar-button--active", (d: DataViewMetadataColumn, i: number) => i === selectedIndex)
            .on("click", (event: MouseEvent, d: DataViewMetadataColumn) => {
                const index = valueSources.indexOf(d);
                if (index >= 0) {
                    this.selectMeasure(index, d.queryName);
                }
            });
    }

    private selectMeasure(index: number, queryName: string | undefined): void {
        if (index === this.selectedMeasureIndex || !this.lastRoot) {
            return;
        }

        this.selectedMeasureIndex = index;
        this.renderMeasureButtons(this.lastValueSources, this.selectedMeasureIndex);

        const treeData = this.buildTreeData(this.lastRoot, index);
        this.lastTreeData = treeData;
        this.renderTree(treeData, this.lastWidth, this.lastHeight);
        this.updateTotalLabel();

        if (queryName) {
            const changes: VisualObjectInstancesToPersist = {
                merge: [{
                    objectName: "state",
                    selector: null,
                    properties: { selectedMeasure: queryName }
                }]
            };
            this.host.persistProperties(changes);
        }
    }

    private updateLevelWarning(levelCount: number): void {
        if (levelCount <= Visual.MAX_SAFE_LEVELS) {
            this.warningBanner.style("display", "none").text("");
            return;
        }

        const message = `This visual is showing ${levelCount} hierarchy levels, above the recommended maximum of ${Visual.MAX_SAFE_LEVELS}. Consider reducing the number of levels for better readability and performance.`;

        this.warningBanner.style("display", null).text(`⚠ ${message}`);
        this.host.displayWarningIcon("Too many hierarchy levels", message);
    }

    private levelColor(level: number): string {
        const palette = this.themeColors.length ? this.themeColors : Visual.LEVEL_COLORS;
        const index = ((level % palette.length) + palette.length) % palette.length;
        return palette[index];
    }

    // Derives per-level colors from the current report theme (falling back to
    // the static Tableau10 palette when a theme color can't be resolved), so
    // the tree matches the rest of the report instead of always looking the
    // same regardless of theme.
    private refreshThemeColors(): void {
        const palette = this.host.colorPalette;
        if (!palette) {
            return;
        }
        this.themeColors = Visual.LEVEL_COLORS.map((fallback, i) => {
            try {
                const info = palette.getColor(`tree-level-${i}`);
                return (info && info.value) || fallback;
            }
            catch (error) {
                return fallback;
            }
        });
    }

    private updateTotalLabel(): void {
        if (!this.lastTreeData || this.lastTreeData.value == null) {
            this.totalLabel.text("");
            return;
        }
        const formatValue = d3.format(",.2~f");
        this.totalLabel.text(`Total: ${formatValue(this.lastTreeData.value)}`);
    }

    // Total hidden descendants under a collapsed node - `children` here is a
    // fully-built (unpruned) subtree snapshot taken just before collapsing,
    // since d3.hierarchy builds the whole tree eagerly up front.
    private countDescendants(children: any[] | undefined): number {
        if (!children || children.length === 0) {
            return 0;
        }
        let count = children.length;
        for (const child of children) {
            count += this.countDescendants(child.children);
        }
        return count;
    }

    private loadSavedViews(dataView: powerbi.DataView | undefined): void {
        const objects = dataView && dataView.metadata && dataView.metadata.objects;
        const persisted = objects && (objects as any).state && (objects as any).state.savedViews;
        if (typeof persisted === "string" && persisted.length > 0) {
            try {
                const parsed = JSON.parse(persisted);
                if (Array.isArray(parsed)) {
                    this.savedViews = parsed;
                }
            }
            catch (error) {
                console.error("Error parsing saved views", error);
            }
        }
        this.renderViewsDropdown();
    }

    private renderViewsDropdown(): void {
        const options = this.viewsSelect.selectAll<HTMLOptionElement, SavedView>("option")
            .data(this.savedViews, (d: SavedView) => d.name);

        options.exit().remove();

        options.enter()
            .append("option")
            .merge(options as any)
            .attr("value", (d: SavedView, i: number) => String(i))
            .text((d: SavedView) => d.name);

        this.viewsSelect.attr("title", this.savedViews.length ? "Saved views" : "No saved views yet");
    }

    private commitSaveView(): void {
        const inputNode = this.saveNameInput.node() as HTMLInputElement;
        const name = inputNode.value.trim();
        if (!name) {
            return;
        }

        const svgNode = this.svg.node();
        const t = svgNode ? d3.zoomTransform(svgNode) : d3.zoomIdentity;

        const view: SavedView = {
            name,
            collapsedPaths: Array.from(this.collapsedPaths),
            searchQuery: this.searchQuery,
            zoom: { x: t.x, y: t.y, k: t.k },
            measureQueryName: this.lastValueSources[this.selectedMeasureIndex]?.queryName
        };

        this.savedViews.push(view);
        this.renderViewsDropdown();
        this.persistSavedViews();
        this.cancelSaveView();
    }

    private cancelSaveView(): void {
        this.saveNameInput.style("display", "none").property("value", "");
    }

    private deleteSelectedView(): void {
        const selectNode = this.viewsSelect.node() as HTMLSelectElement;
        const idx = Number(selectNode.value);
        if (Number.isNaN(idx) || !this.savedViews[idx]) {
            return;
        }

        this.savedViews.splice(idx, 1);
        this.renderViewsDropdown();
        this.persistSavedViews();
    }

    private persistSavedViews(): void {
        const changes: VisualObjectInstancesToPersist = {
            merge: [{
                objectName: "state",
                selector: null,
                properties: { savedViews: JSON.stringify(this.savedViews) }
            }]
        };
        this.host.persistProperties(changes);
    }

    // Computes a translate that clears the toolbar (measured live, not a
    // fixed guess) on the tree's depth-start side, and anchors the root node
    // on the spread axis, at zoom scale `k`. Anchoring on the root - rather
    // than the midpoint of every currently-visible node's extent - is
    // deliberate: two saved views can have very different collapse states
    // (e.g. one branch drilled 5 levels deep while its siblings stay
    // collapsed), which skews an extent midpoint far to whichever side
    // happens to be more expanded. That skew is exactly what made switching
    // saved views appear to fling the tree toward one edge instead of
    // holding still. The root is a single stable point that's always
    // present, so it gives a consistent anchor regardless of how lopsided
    // the current expansion is.
    private computeCenterTransform(
        rootPoint: { x: number; y: number } | undefined,
        orientation: string,
        width: number,
        height: number,
        k: number
    ): { x: number; y: number } {
        const toolbarNode = this.toolbar.node();
        const margin = (toolbarNode ? toolbarNode.getBoundingClientRect().height : 40) + 16;

        if (!rootPoint) {
            return {
                x: orientation === "horizontal" ? margin : width / 2,
                y: orientation === "horizontal" ? height / 2 : margin
            };
        }

        return {
            x: orientation === "horizontal" ? margin : width / 2 - rootPoint.x * k,
            y: orientation === "horizontal" ? height / 2 - rootPoint.y * k : margin
        };
    }

    // Saved views only capture what the visual itself controls - expand
    // state, search, zoom, and which of the (already field-well-bound)
    // measures is active. It can't add/remove fields from the Hierarchy
    // levels or Measure wells - custom visuals have no write access to a
    // report's field bindings, so switching views can never change which
    // columns are on the visual. If the saved measure isn't currently bound
    // (e.g. it was removed from the field well since saving), this is a
    // silent no-op rather than an error.
    private applyMeasureForView(measureQueryName: string | undefined): void {
        if (!measureQueryName || !this.lastRoot) {
            return;
        }
        const index = this.lastValueSources.findIndex(v => v.queryName === measureQueryName);
        if (index < 0 || index === this.selectedMeasureIndex) {
            return;
        }

        this.selectedMeasureIndex = index;
        this.renderMeasureButtons(this.lastValueSources, index);
        this.lastTreeData = this.buildTreeData(this.lastRoot, index);
        this.updateTotalLabel();

        const changes: VisualObjectInstancesToPersist = {
            merge: [{
                objectName: "state",
                selector: null,
                properties: { selectedMeasure: measureQueryName }
            }]
        };
        this.host.persistProperties(changes);
    }

    private restoreView(view: SavedView): void {
        this.applyMeasureForView(view.measureQueryName);

        this.collapsedPaths = new Set(view.collapsedPaths);
        this.searchQuery = view.searchQuery || "";
        this.searchInput.property("value", this.searchQuery);
        this.searchMatchPaths.clear();
        this.searchMatchList = [];
        this.searchMatchIndex = -1;

        if (this.lastTreeData && this.searchQuery) {
            const matchedNodes: TreeDatum[] = [];
            this.collectMatchingNodes(this.lastTreeData, this.searchQuery, matchedNodes);
            this.searchMatchList = matchedNodes.map(n => n.path);
            this.searchMatchList.forEach(p => this.searchMatchPaths.add(p));
            this.searchMatchIndex = this.searchMatchList.length ? 0 : -1;
            this.applySearchSelection(matchedNodes);
        } else {
            this.selectionManager.clear().then(() => this.updateSelectionStyles());
        }

        // Skip renderTree's own auto-center: the saved zoom transform below is
        // authoritative for this restore.
        this.hasCentered = true;
        if (this.lastTreeData) {
            this.renderTree(this.lastTreeData, this.lastWidth, this.lastHeight);
        }

        const svgNode = this.svg.node();
        if (svgNode) {
            // Recompute the pan from the just-rendered node positions rather
            // than replaying the saved x/y verbatim - those were captured
            // against whatever toolbar height/canvas size was in effect at
            // save time, and replaying them stale is what caused restored
            // views to land behind the toolbar. Only the zoom scale is worth
            // preserving from the saved view.
            const orientation = this.formattingSettings.layoutCard.orientation.value.value as string;
            const rootPoint = this.lastTreeData ? this.lastNodePositions.get(this.lastTreeData.path) : undefined;
            const centered = this.computeCenterTransform(rootPoint, orientation, this.lastWidth, this.lastHeight, view.zoom.k);
            this.svg.call(this.zoomBehavior.transform, d3.zoomIdentity.translate(centered.x, centered.y).scale(view.zoom.k));
        }

        this.updateSearchStatus();
    }

    private buildLinkPath(d: d3.HierarchyLink<TreeDatum>, orientation: string, style: string): string {
        const s: any = d.source;
        const t: any = d.target;

        const sx = orientation === "horizontal" ? s.y : s.x;
        const sy = orientation === "horizontal" ? s.x : s.y;
        const tx = orientation === "horizontal" ? t.y : t.x;
        const ty = orientation === "horizontal" ? t.x : t.y;

        if (style === "elbow") {
            const midY = (sy + ty) / 2;
            return `M${sx},${sy} V${midY} H${tx} V${ty}`;
        }

        const midY = (sy + ty) / 2;
        return `M${sx},${sy} C${sx},${midY} ${tx},${midY} ${tx},${ty}`;
    }

    private renderTree(data: TreeDatum, width: number, height: number): void {
        const settings = this.formattingSettings;
        const orientation = settings.layoutCard.orientation.value.value as string;
        const nodeSpacing = settings.layoutCard.nodeSpacing.value;
        const linkStyle = settings.layoutCard.linkStyle.value.value as string;

        if (this.lastOrientation !== null && this.lastOrientation !== orientation) {
            this.hasCentered = false;
        }
        this.lastOrientation = orientation;

        const root: any = d3.hierarchy<TreeDatum>(data, d => d.children);

        root.each((n: any) => {
            if (this.collapsedPaths.has(n.data.path) && n.children) {
                n._children = n.children;
                n.children = undefined;
                n.__hiddenCount = this.countDescendants(n._children);
            }
        });

        const values = root.descendants()
            .map((d: any) => d.data.value)
            .filter((v: number) => v != null && v > 0);
        const minValue = values.length ? Math.min(...values) : 0;
        const maxValue = values.length ? Math.max(...values) : 1;

        const colorScale = d3.scaleLinear<string>()
            .domain([minValue, maxValue])
            .range([settings.nodesCard.minColor.value.value, settings.nodesCard.maxColor.value.value])
            .clamp(true);

        const defaultRadius = settings.nodesCard.defaultRadius.value;
        const radiusScale = d3.scaleSqrt()
            .domain([minValue, maxValue])
            .range([Math.max(defaultRadius * 0.6, 3), Math.max(defaultRadius * 2, 12)])
            .clamp(true);

        const getRadius = (d: any) => {
            const useSize = settings.nodesCard.sizeByMeasure.value && d.data.value != null;
            return useSize ? radiusScale(d.data.value) : defaultRadius;
        };

        const treeLayout = d3.tree<TreeDatum>().nodeSize([nodeSpacing, nodeSpacing * 2.2]);
        treeLayout(root);

        const nodes: any[] = root.descendants();
        const links: any[] = root.links();

        const getX = (n: any) => orientation === "horizontal" ? n.y : n.x;
        const getY = (n: any) => orientation === "horizontal" ? n.x : n.y;

        this.lastNodePositions.clear();
        nodes.forEach((n: any) => this.lastNodePositions.set(n.data.path, { x: getX(n), y: getY(n) }));

        const staggerLevels = 3;
        const depthGroups = new Map<number, any[]>();
        nodes.forEach((n: any) => {
            if (!depthGroups.has(n.depth)) {
                depthGroups.set(n.depth, []);
            }
            depthGroups.get(n.depth)!.push(n);
        });
        depthGroups.forEach(group => {
            group.sort((a, b) => a.x - b.x);
            group.forEach((n, i) => {
                n.__stagger = group.length > 1 ? i % staggerLevels : 1;
            });
        });

        // A node with a single visible child inherits that child's spread
        // coordinate exactly (d3.tree centers a parent on the mean of its
        // children's x, which for one child is just that child's x). That
        // lets a parent/child pair land at the same spread position even
        // though they're staggered independently above (different depths),
        // so their labels - both offset the same way if both are branches -
        // can end up overlapping. Re-stagger any such cross-depth cluster.
        const spreadClusters = new Map<number, any[]>();
        nodes.forEach((n: any) => {
            const key = Math.round(n.x);
            if (!spreadClusters.has(key)) {
                spreadClusters.set(key, []);
            }
            spreadClusters.get(key)!.push(n);
        });
        spreadClusters.forEach(cluster => {
            if (cluster.length > 1) {
                cluster.sort((a, b) => a.depth - b.depth);
                cluster.forEach((n, i) => {
                    n.__stagger = i % staggerLevels;
                });
            }
        });

        // Each stagger band must clear a full two-line label (name + value) so
        // adjacent bands never overlap vertically, even when siblings sit close
        // together horizontally.
        const labelLineHeight = settings.dataLabelsCard.fontSize.value * 1.2;
        const staggerStep = labelLineHeight * 2 + 8;

        if (!this.hasCentered) {
            const rootPoint = { x: getX(root), y: getY(root) };
            const centered = this.computeCenterTransform(rootPoint, orientation, width, height, 1);

            this.svg.call(this.zoomBehavior.transform, d3.zoomIdentity.translate(centered.x, centered.y));
            this.hasCentered = true;
        }

        const linkSelection = this.linkLayer.selectAll<SVGPathElement, any>("path.link")
            .data(links, (d: any) => d.target.data.path);

        linkSelection.exit().remove();

        linkSelection.enter()
            .append("path")
            .attr("class", "link")
            .merge(linkSelection as any)
            .attr("d", (d: any) => this.buildLinkPath(d, orientation, linkStyle));

        const nodeSelection = this.nodeLayer.selectAll<SVGGElement, any>("g.node")
            .data(nodes, (d: any) => d.data.path);

        nodeSelection.exit().remove();

        const nodeEnter = nodeSelection.enter()
            .append("g")
            .attr("class", "node")
            .attr("transform", (d: any) => `translate(${getX(d)},${getY(d)})`);

        nodeEnter.append("line").attr("class", "label-connector");
        nodeEnter.append("circle");
        nodeEnter.append("text");

        const badgeEnter = nodeEnter.append("g").attr("class", "node-badge");
        badgeEnter.append("circle");
        badgeEnter.append("text");

        const nodeMerge = nodeEnter.merge(nodeSelection as any);

        nodeMerge.attr("transform", (d: any) => `translate(${getX(d)},${getY(d)})`);

        nodeMerge.select("circle")
            .attr("r", (d: any) => getRadius(d))
            .attr("fill", (d: any) => {
                const useColor = settings.nodesCard.colorByMeasure.value && d.data.value != null;
                if (useColor) {
                    return colorScale(d.data.value);
                }
                return d.data.level < 0 ? Visual.ROOT_SUMMARY_COLOR : this.levelColor(d.data.level);
            })
            .attr("class", (d: any) => (d.children || d._children) ? "has-children" : "leaf");

        nodeMerge.classed("search-match", (d: any) => this.searchMatchPaths.has(d.data.path));

        const currentMatchPath = this.searchMatchIndex >= 0 ? this.searchMatchList[this.searchMatchIndex] : null;
        nodeMerge.classed("search-current", (d: any) => currentMatchPath !== null && d.data.path === currentMatchPath);

        const getBadgeOffset = (d: any) => {
            const r = getRadius(d);
            return { x: r * 0.7, y: -r * 0.7 };
        };

        const badgeGroup = nodeMerge.select("g.node-badge")
            .style("display", (d: any) => (d._children && d.__hiddenCount > 0) ? null : "none")
            .attr("transform", (d: any) => {
                const offset = getBadgeOffset(d);
                return `translate(${offset.x},${offset.y})`;
            });

        badgeGroup.select("circle")
            .attr("r", 8);

        badgeGroup.select("text")
            .attr("dy", "0.32em")
            .text((d: any) => d.__hiddenCount > 99 ? "99+" : `+${d.__hiddenCount}`);

        const formatValue = d3.format(",.2~f");
        const formatPercent = d3.format(".1%");

        const getPercentOfParent = (d: any): number | null => {
            if (!settings.dataLabelsCard.showPercentOfParent.value) {
                return null;
            }
            const parentValue = d.parent && d.parent.data.value;
            if (d.data.value == null || !parentValue) {
                return null;
            }
            return d.data.value / parentValue;
        };

        // Single source of truth for where a node's label sits, relative to the
        // node's own (0,0) origin — used for the text position AND the leader
        // line that visually ties a staggered/offset label back to its node.
        const getLabelAnchor = (d: any): { dx: number; y: number } => {
            const isBranch = !!(d.children || d._children);
            const stagger = settings.dataLabelsCard.staggerLabels.value ? ((d.__stagger ?? 1) - 1) * staggerStep : 0;

            if (orientation === "horizontal") {
                const clearance = getRadius(d) + 10;
                const baseY = isBranch ? -clearance : clearance;
                return { dx: 0, y: baseY + stagger };
            }

            const clearance = getRadius(d) + 8;
            return { dx: isBranch ? -clearance : clearance, y: stagger };
        };

        nodeMerge.select("text").each(function (d: any) {
            const textSel = d3.select(this as SVGTextElement);
            textSel.selectAll("tspan").remove();

            if (!settings.dataLabelsCard.show.value) {
                return;
            }

            const { dx } = getLabelAnchor(d);

            textSel.append("tspan")
                .attr("x", dx)
                .attr("dy", d.data.value != null ? "-0.1em" : "0.32em")
                .text(d.data.name);

            if (d.data.value != null) {
                const pct = getPercentOfParent(d);
                const pctSuffix = pct != null ? ` (${formatPercent(pct)})` : "";
                textSel.append("tspan")
                    .attr("class", "value-label")
                    .attr("x", dx)
                    .attr("dy", "1.1em")
                    .text(formatValue(d.data.value) + pctSuffix);
            }
        });

        nodeMerge.select("text")
            .style("display", settings.dataLabelsCard.show.value ? null : "none")
            .style("font-family", settings.dataLabelsCard.fontFamily.value)
            .style("font-size", `${settings.dataLabelsCard.fontSize.value}px`)
            .style("fill", settings.dataLabelsCard.color.value.value)
            .attr("y", (d: any) => getLabelAnchor(d).y)
            .attr("text-anchor", (d: any) => orientation === "horizontal" ? "middle" : ((d.children || d._children) ? "end" : "start"));

        nodeMerge.select("line.label-connector")
            .style("display", settings.dataLabelsCard.show.value && settings.dataLabelsCard.staggerLabels.value ? null : "none")
            .attr("x1", 0)
            .attr("y1", 0)
            .attr("x2", (d: any) => getLabelAnchor(d).dx)
            .attr("y2", (d: any) => getLabelAnchor(d).y);

        nodeMerge
            .on("click", (event: MouseEvent, d: any) => {
                event.stopPropagation();
                this.onNodeClick(event, d);
            })
            .on("mouseenter", (event: MouseEvent, d: any) => this.showTooltip(event, d))
            .on("mousemove", (event: MouseEvent) => this.moveTooltip(event))
            .on("mouseleave", () => this.hideTooltip());

        this.updateSelectionStyles();
    }

    private onNodeClick(event: MouseEvent, d: any): void {
        const isBranch = !!(d.children || d._children);

        if (isBranch) {
            if (this.collapsedPaths.has(d.data.path)) {
                this.collapsedPaths.delete(d.data.path);
            } else {
                this.collapsedPaths.add(d.data.path);
            }

            if (this.lastTreeData) {
                this.renderTree(this.lastTreeData, this.lastWidth, this.lastHeight);
            }
            return;
        }

        this.selectionManager.select(d.data.selectionId, event.ctrlKey || event.metaKey)
            .then(() => this.updateSelectionStyles());
    }

    private updateSelectionStyles(): void {
        const selectedIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSelection = selectedIds.length > 0;

        this.nodeLayer.selectAll<SVGGElement, any>("g.node")
            .style("opacity", (d: any) => {
                if (d.data.selectionId === null || !hasSelection) {
                    return 1;
                }
                return selectedIds.some(id => id.equals(d.data.selectionId)) ? 1 : 0.3;
            });
    }

    private showTooltip(event: MouseEvent, d: any): void {
        const path = d.ancestors().reverse().map((n: any) => n.data.name).join(" › ");
        const dataItems: VisualTooltipDataItem[] = [
            { displayName: "Path", value: path }
        ];
        if (d.data.value != null) {
            dataItems.push({ displayName: "Value", value: String(d.data.value) });

            const parentValue = d.parent && d.parent.data.value;
            if (parentValue) {
                dataItems.push({ displayName: "% of parent", value: d3.format(".1%")(d.data.value / parentValue) });
            }
        }

        this.host.tooltipService.show({
            coordinates: [event.clientX, event.clientY],
            isTouchEvent: false,
            dataItems,
            identities: d.data.selectionId !== null ? [d.data.selectionId] : []
        });
    }

    private moveTooltip(event: MouseEvent): void {
        this.host.tooltipService.move({
            coordinates: [event.clientX, event.clientY],
            isTouchEvent: false,
            identities: []
        });
    }

    private hideTooltip(): void {
        this.host.tooltipService.hide({ isTouchEvent: false, immediately: true });
    }

    public destroy(): void {
        this.svg.on(".zoom", null);
        this.svg.selectAll("*").remove();
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
