interface ErrorLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  cause?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

function redact(value: string): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted-key]")
    .replace(/bot[0-9]+:[0-9A-Za-z_-]+/g, "[redacted-bot-token]")
    .replace(/(?:postgres(?:ql)?|mysql):\/\/\S+/gi, "[redacted-database-url]");
}

export interface SafeErrorMetadata {
  name: string;
  message: string;
  status?: number | string;
  code?: number | string;
  apiStatus?: string;
  cause?: {
    name: string;
    message: string;
    status?: number | string;
    code?: number | string;
    apiStatus?: string;
  };
}

function oneLevel(value: unknown): SafeErrorMetadata | undefined {
  if (!isErrorLike(value)) return undefined;
  const rawMessage = value.message instanceof Error
    ? value.message.message
    : typeof value.message === "string"
      ? value.message
      : String(value.message ?? value);
  let parsed: { error?: { code?: unknown; status?: unknown; message?: unknown } } | undefined;
  try {
    parsed = JSON.parse(rawMessage) as typeof parsed;
  } catch {
    parsed = undefined;
  }
  const apiError = parsed?.error;
  const metadata: SafeErrorMetadata = {
    name: typeof value.name === "string" ? value.name : "Error",
    message: redact(
      typeof apiError?.message === "string" ? apiError.message : rawMessage,
    ).slice(0, 500),
  };
  const status = value.status ?? apiError?.code;
  const code = value.code ?? apiError?.code;
  const apiStatus = apiError?.status;
  if (typeof status === "number" || typeof status === "string") metadata.status = status;
  if (typeof code === "number" || typeof code === "string") metadata.code = code;
  if (typeof apiStatus === "string") metadata.apiStatus = apiStatus;
  return metadata;
}

export function safeErrorMetadata(error: unknown): SafeErrorMetadata {
  const metadata = oneLevel(error) ?? {
    name: "UnknownError",
    message: redact(String(error)).slice(0, 500),
  };
  if (isErrorLike(error) && error.cause) {
    const cause = oneLevel(error.cause);
    if (cause) {
      metadata.cause = {
        name: cause.name,
        message: cause.message,
        ...(cause.status === undefined ? {} : { status: cause.status }),
        ...(cause.code === undefined ? {} : { code: cause.code }),
        ...(cause.apiStatus === undefined ? {} : { apiStatus: cause.apiStatus }),
      };
    }
  }
  return metadata;
}