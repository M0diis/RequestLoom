export function appendQueryParameter(url: string, key: string, value: string): string {
  const fragmentIndex = url.indexOf('#');
  const target = fragmentIndex < 0 ? url : url.slice(0, fragmentIndex);
  const fragment = fragmentIndex < 0 ? '' : url.slice(fragmentIndex);
  const separator = target.endsWith('?') || target.endsWith('&') ? '' : target.includes('?') ? '&' : '?';
  return `${target}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}${fragment}`;
}
