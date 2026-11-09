import type { AgReportState } from "ag-studio";

const equals = (fieldId: string, value: string) => ({
  field: { id: fieldId },
  view: { viewTypeId: "simple" },
  model: { operator: "equals", value },
});

const tile = (title: string) => ({ title: { enabled: true, text: title }, style: { label: { enabled: true } } });

/**
 * The report Guardian analytics opens with, so the first view is a working dashboard and not an empty canvas.
 * The grid has 24 columns. Everything here reads the live tables from `data.ts`, and the assistant can add to it
 * or change it from the chat.
 */
export const initialReport = {
  pages: [
    {
      id: "page-1",
      widgets: {
        "stopped-value": {
          type: "value",
          format: tile("Value stopped"),
          dataMapping: { value: [{ id: "proposals.stopped_value", aggregation: "sum" }] },
        },
        reviewed: {
          type: "value",
          format: tile("Reviewed"),
          dataMapping: { value: [{ id: "proposals.id", aggregation: "count" }] },
        },
        blocked: {
          type: "value",
          format: tile("Blocked"),
          dataMapping: { value: [{ id: "proposals.id", aggregation: "count" }] },
        },
        overcharge: {
          type: "value",
          format: tile("Overcharges"),
          dataMapping: { value: [{ id: "proposals.overcharge", aggregation: "sum" }] },
        },
        verdicts: {
          type: "donut-chart",
          format: { title: { enabled: true, text: "Guardian verdicts" } },
          dataMapping: { categoryKey: [{ id: "proposals.verdict" }], valueKey: [{ id: "proposals.id", aggregation: "count" }] },
        },
        outcomes: {
          type: "column-chart-grouped",
          format: { title: { enabled: true, text: "Where purchases ended up" } },
          dataMapping: { categoryKey: [{ id: "proposals.outcome" }], valueKey: [{ id: "proposals.id", aggregation: "count" }] },
        },
        rules: {
          type: "bar-chart-grouped",
          format: { title: { enabled: true, text: "Rules that failed" } },
          dataMapping: { categoryKey: [{ id: "findings.rule" }], valueKey: [{ id: "findings.id", aggregation: "count" }] },
        },
        proposals: {
          type: "grid",
          format: { title: { enabled: true, text: "Every proposal and what the Guardian decided" } },
          dataMapping: {
            cols: [
              { id: "proposals.title" },
              { id: "proposals.seller" },
              { id: "proposals.price" },
              { id: "proposals.verdict" },
              { id: "proposals.outcome" },
            ],
          },
        },
      },
      widgetLayout: {
        "stopped-value": { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 12 },
        reviewed: { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 12 },
        blocked: { xTrack: 12, yTrack: 0, xSpan: 6, ySpan: 12 },
        overcharge: { xTrack: 18, yTrack: 0, xSpan: 6, ySpan: 12 },
        verdicts: { xTrack: 0, yTrack: 12, xSpan: 8, ySpan: 38 },
        outcomes: { xTrack: 8, yTrack: 12, xSpan: 8, ySpan: 38 },
        rules: { xTrack: 16, yTrack: 12, xSpan: 8, ySpan: 38 },
        proposals: { xTrack: 0, yTrack: 50, xSpan: 24, ySpan: 36 },
      },
      filter: {
        widget: {
          blocked: [equals("proposals.verdict", "block")],
          rules: [equals("findings.result", "Failed")],
        },
      },
    },
  ],
  selectedPageId: "page-1",
  panels: { data: { collapsed: true }, edit: { collapsed: true } },
} as unknown as AgReportState;
