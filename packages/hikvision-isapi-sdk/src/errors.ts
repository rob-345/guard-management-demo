export class HikvisionSdkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

export class HikvisionAuthError extends HikvisionSdkError {}

export class HikvisionUnsupportedCapabilityError extends HikvisionSdkError {}

export class HikvisionInvalidResponseError extends HikvisionSdkError {
  constructor(
    message: string,
    readonly details?: {
      statusCode?: number | string;
      statusString?: string;
      subStatusCode?: string;
      errorCode?: number | string;
      errorMsg?: string;
      body?: string;
    },
    cause?: unknown
  ) {
    super(message, cause);
  }
}

export class HikvisionCaptureError extends HikvisionSdkError {}

export class HikvisionFaceUploadError extends HikvisionSdkError {}

export class HikvisionVerificationError extends HikvisionSdkError {}

export class HikvisionTransportError extends HikvisionSdkError {
  constructor(message: string, readonly status?: number, cause?: unknown) {
    super(message, cause);
  }
}
