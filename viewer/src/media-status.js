export const MEDIA_ERROR = Object.freeze({
  ABORTED: 1,
  NETWORK: 2,
  DECODE: 3,
  UNSUPPORTED: 4,
})

export function describeMediaError(code) {
  switch (Number(code)) {
    case MEDIA_ERROR.ABORTED:
      return {
        title: 'Footage loading was interrupted',
        detail: 'The browser stopped loading this plate before it was ready. Retry the footage to continue.',
        retryable: true,
      }
    case MEDIA_ERROR.NETWORK:
      return {
        title: 'Footage could not be downloaded',
        detail: 'The plate host or network did not complete the video request. Check the connection, then retry.',
        retryable: true,
      }
    case MEDIA_ERROR.DECODE:
      return {
        title: 'Footage could not be decoded',
        detail: 'The browser received the video but could not play its encoding. Try a supported MP4, MOV, or WebM preview.',
        retryable: false,
      }
    case MEDIA_ERROR.UNSUPPORTED:
      return {
        title: 'Footage format is not supported',
        detail: 'The URL or file is unavailable to this browser, blocked by its host, or uses an unsupported video format.',
        retryable: false,
      }
    default:
      return {
        title: 'Footage could not be loaded',
        detail: 'The Studio could not open this plate. Check the source and try loading it again.',
        retryable: true,
      }
  }
}
