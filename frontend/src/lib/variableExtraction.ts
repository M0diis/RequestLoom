import type { ApiRequest, Service } from '../types';

export interface UrlOccurrence {
  id: string;
  requestId: string;
  serviceId: string | null;
  location: string;
  url: string;
  start: number;
  end: number;
}

export function findUrlOccurrences(services: Service[], requests: ApiRequest[], value: string): UrlOccurrence[] {
  if (!value) return [];
  const result: UrlOccurrence[] = [];
  for (const request of [...requests, ...services.flatMap(service => service.requests)]) {
    const service = services.find(item => item.id === request.serviceId);
    const folders: string[] = [];
    const seen = new Set<string>();
    let folder = service?.folders.find(item => item.id === request.folderId);
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      folders.unshift(folder.name);
      folder = service?.folders.find(item => item.id === folder!.parentFolderId);
    }
    const location = [service?.name ?? (request.ephemeral ? 'Ephemeral' : 'Top level'), ...folders, request.name].join(' / ');
    for (let start = request.url.indexOf(value); start >= 0; start = request.url.indexOf(value, start + value.length)) {
      result.push({ id: `${request.id}:${start}`, requestId: request.id, serviceId: request.serviceId,
        location, url: request.url, start, end: start + value.length });
    }
  }
  return result;
}

export function replaceUrlOccurrences(url: string, value: string, replacement: string, occurrences: UrlOccurrence[]): string {
  let result = url;
  for (const occurrence of [...occurrences].sort((a, b) => b.start - a.start)) {
    if (url !== occurrence.url || url.slice(occurrence.start, occurrence.end) !== value) {
      throw new Error('A matching URL changed. Review the occurrences and try again.');
    }
    result = result.slice(0, occurrence.start) + replacement + result.slice(occurrence.end);
  }
  return result;
}
