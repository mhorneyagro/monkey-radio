import type { GenreId } from "@monkey-radio/shared";

export interface ArchiveSearchResult {
  identifier: string;
  title: string;
}

export interface ArchiveAudioFile {
  name: string;
  size: number;
  length: number;
}

export interface ArchiveMetadata {
  identifier: string;
  title: string;
  files: ArchiveAudioFile[];
}

const GENRE_QUERIES: Record<GenreId, string> = {
  jazz: "collection:netlabels AND mediatype:audio AND format:MP3 AND jazz",
  synthwave:
    "collection:netlabels AND mediatype:audio AND format:MP3 AND (synth OR synthwave OR electronic)",
  lofi: "collection:netlabels AND mediatype:audio AND format:MP3 AND (lofi OR chill OR downtempo)",
  ambient:
    "collection:netlabels AND mediatype:audio AND format:MP3 AND ambient",
  funk: "collection:netlabels AND mediatype:audio AND format:MP3 AND funk",
  rock: "collection:netlabels AND mediatype:audio AND format:MP3 AND (rock OR indie)",
};

const MIN_DURATION_SEC = 45;
const MIN_FILE_BYTES = 500_000;

export function getArchiveQueryForGenre(genre: GenreId): string {
  return GENRE_QUERIES[genre];
}

export async function searchArchiveItems(
  query: string,
  page: number,
  rows = 20,
): Promise<ArchiveSearchResult[]> {
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}` +
    `&fl=identifier,title&rows=${rows}&page=${page}&output=json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Archive search failed (${response.status})`);
  }

  const data = (await response.json()) as {
    response?: { docs?: ArchiveSearchResult[] };
  };

  return data.response?.docs ?? [];
}

export async function getArchiveMetadata(
  identifier: string,
): Promise<ArchiveMetadata | null> {
  const response = await fetch(
    `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
  );
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    metadata?: { title?: string; identifier?: string };
    files?: Array<{ name?: string; size?: string; length?: string; format?: string }>;
  };

  const files: ArchiveAudioFile[] = (data.files ?? [])
    .filter((file) => file.name?.toLowerCase().endsWith(".mp3"))
    .map((file) => ({
      name: file.name!,
      size: Number(file.size ?? 0),
      length: Number(file.length ?? 0),
    }))
    .filter(
      (file) =>
        file.size >= MIN_FILE_BYTES && file.length >= MIN_DURATION_SEC,
    );

  if (files.length === 0) {
    return null;
  }

  return {
    identifier,
    title: data.metadata?.title ?? identifier,
    files,
  };
}

export function getArchiveDownloadUrl(
  identifier: string,
  filename: string,
): string {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`;
}

export function makeArchiveExternalId(
  identifier: string,
  filename: string,
): string {
  return `archive:${identifier}/${filename}`;
}
