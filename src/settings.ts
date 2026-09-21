"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

class LayoutCardSettings extends FormattingSettingsCard {
    orientation = new formattingSettings.ItemDropdown({
        name: "orientation",
        displayName: "Orientation",
        items: [
            { displayName: "Vertical (top-down)", value: "vertical" },
            { displayName: "Horizontal (left-right)", value: "horizontal" }
        ],
        value: { displayName: "Vertical (top-down)", value: "vertical" }
    });

    nodeSpacing = new formattingSettings.NumUpDown({
        name: "nodeSpacing",
        displayName: "Node spacing",
        value: 60
    });

    linkStyle = new formattingSettings.ItemDropdown({
        name: "linkStyle",
        displayName: "Link style",
        items: [
            { displayName: "Curved", value: "curved" },
            { displayName: "Elbow", value: "elbow" }
        ],
        value: { displayName: "Curved", value: "curved" }
    });

    name: string = "layout";
    displayName: string = "Layout";
    slices: Array<FormattingSettingsSlice> = [this.orientation, this.nodeSpacing, this.linkStyle];
}

class NodesCardSettings extends FormattingSettingsCard {
    defaultRadius = new formattingSettings.NumUpDown({
        name: "defaultRadius",
        displayName: "Default radius",
        value: 6
    });

    colorByMeasure = new formattingSettings.ToggleSwitch({
        name: "colorByMeasure",
        displayName: "Color by measure",
        value: false
    });

    sizeByMeasure = new formattingSettings.ToggleSwitch({
        name: "sizeByMeasure",
        displayName: "Size by measure",
        value: true
    });

    minColor = new formattingSettings.ColorPicker({
        name: "minColor",
        displayName: "Min color",
        value: { value: "#DEEBF7" }
    });

    maxColor = new formattingSettings.ColorPicker({
        name: "maxColor",
        displayName: "Max color",
        value: { value: "#08519C" }
    });

    name: string = "nodes";
    displayName: string = "Nodes";
    slices: Array<FormattingSettingsSlice> = [
        this.defaultRadius,
        this.colorByMeasure,
        this.sizeByMeasure,
        this.minColor,
        this.maxColor
    ];
}

class DataLabelsCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show",
        value: true
    });

    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Font family",
        value: "Segoe UI, wf_segoe-ui_normal, helvetica, arial, sans-serif"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Text size",
        value: 11
    });

    color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "Font color",
        value: { value: "#252423" }
    });

    staggerLabels = new formattingSettings.ToggleSwitch({
        name: "staggerLabels",
        displayName: "Stagger labels",
        value: true
    });

    showPercentOfParent = new formattingSettings.ToggleSwitch({
        name: "showPercentOfParent",
        displayName: "Show % of parent",
        value: true
    });

    name: string = "dataLabels";
    displayName: string = "Data labels";
    slices: Array<FormattingSettingsSlice> = [
        this.show,
        this.fontFamily,
        this.fontSize,
        this.color,
        this.staggerLabels,
        this.showPercentOfParent
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    layoutCard = new LayoutCardSettings();
    nodesCard = new NodesCardSettings();
    dataLabelsCard = new DataLabelsCardSettings();

    cards = [this.layoutCard, this.nodesCard, this.dataLabelsCard];
}
