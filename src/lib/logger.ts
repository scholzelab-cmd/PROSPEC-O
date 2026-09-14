type LogLevel = "debug" | "info" | "warn" | "error";

const secretKeyPattern = /(token|secret|password|authorization|api[_-]?key)/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        secretKeyPattern.test(key) ? "[REDACTED]" : sanitize(entry)
      ])
    );
  }

  return value;
}

function write(level: LogLevel, message: string, context?: object): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { context: sanitize(context) } : {})
  };

  const output = JSON.stringify(entry);

  if (level === "error") {
    console.error(output);
    return;
  }

  if (level === "warn") {
    console.warn(output);
    return;
  }

  console.log(output);
}

export const logger = {
  debug: (message: string, context?: object) => write("debug", message, context),
  info: (message: string, context?: object) => write("info", message, context),
  warn: (message: string, context?: object) => write("warn", message, context),
  error: (message: string, context?: object) => write("error", message, context)
};
