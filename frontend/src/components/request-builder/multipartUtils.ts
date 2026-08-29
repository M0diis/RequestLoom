export function createEmptyMultipartBody(): string {
  return JSON.stringify({
    fields: [{
      name: '',
      kind: 'text',
      value: '',
      filePath: '',
      fileName: '',
      contentType: 'application/octet-stream',
      enabled: true,
    }],
  });
}
