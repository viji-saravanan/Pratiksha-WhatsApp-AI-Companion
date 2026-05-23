export interface CliOutput {
  write(text: string): void;
  error(text: string): void;
}

export const processOutput: CliOutput = {
  write(text: string): void {
    process.stdout.write(text);
  },
  error(text: string): void {
    process.stderr.write(text);
  }
};

export function writeJson(output: CliOutput, value: unknown): void {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}
