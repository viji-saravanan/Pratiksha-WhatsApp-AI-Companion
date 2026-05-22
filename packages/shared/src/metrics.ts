export type PrometheusMetricType = "counter" | "gauge";

export interface PrometheusMetricSample {
  name: string;
  help: string;
  type: PrometheusMetricType;
  value: number;
  labels?: Record<string, string | number | boolean | null | undefined>;
}

const METRIC_NAME_PATTERN = /^viji_[a-zA-Z_:][a-zA-Z0-9_:]*$/;

export function renderPrometheusMetrics(
  samples: readonly PrometheusMetricSample[]
): string {
  const headers = new Set<string>();
  const lines: string[] = [];

  for (const sample of samples) {
    assertVijiMetricName(sample.name);
    if (!Number.isFinite(sample.value)) {
      throw new Error(`Metric ${sample.name} value must be finite`);
    }

    if (!headers.has(sample.name)) {
      lines.push(`# HELP ${sample.name} ${escapeHelp(sample.help)}`);
      lines.push(`# TYPE ${sample.name} ${sample.type}`);
      headers.add(sample.name);
    }

    lines.push(`${sample.name}${renderLabels(sample.labels)} ${sample.value}`);
  }

  return `${lines.join("\n")}\n`;
}

export function assertVijiMetricName(name: string): void {
  if (!METRIC_NAME_PATTERN.test(name)) {
    throw new Error(`Metric name must start with viji_: ${name}`);
  }
}

function renderLabels(
  labels: PrometheusMetricSample["labels"] = {}
): string {
  const entries = Object.entries(labels).filter(
    (entry): entry is [string, string | number | boolean] =>
      entry[1] !== null && entry[1] !== undefined
  );
  if (entries.length === 0) {
    return "";
  }

  return `{${entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${escapeLabelValue(String(value))}"`)
    .join(",")}}`;
}

function escapeHelp(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function escapeLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}
