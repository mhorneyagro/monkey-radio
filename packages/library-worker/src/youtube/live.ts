import type { YouTubeAuthConfig } from "./auth.js";
import { getYouTubeAccessToken } from "./auth.js";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

export interface LiveBroadcastInfo {
  broadcastId: string;
  streamId: string;
  videoId: string;
  title: string;
  lifeCycleStatus: string;
  streamStatus: string;
  rtmpUrl: string;
  streamKey: string;
}

async function youtubeFetch<T>(
  path: string,
  auth: YouTubeAuthConfig,
  options: RequestInit = {},
): Promise<T> {
  const accessToken = await getYouTubeAccessToken(auth);
  const response = await fetch(`${YOUTUBE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube API ${path} failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function createLiveBroadcast(
  auth: YouTubeAuthConfig,
  title: string,
  description: string,
): Promise<LiveBroadcastInfo> {
  const scheduledStart = new Date(Date.now() + 60_000).toISOString();

  const broadcast = await youtubeFetch<{
    id: string;
    snippet?: { title?: string };
    status?: { lifeCycleStatus?: string };
  }>(`/liveBroadcasts?part=snippet,status,contentDetails`, auth, {
    method: "POST",
    body: JSON.stringify({
      snippet: {
        title,
        description,
        scheduledStartTime: scheduledStart,
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
      },
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: false,
        enableDvr: true,
        recordFromStart: true,
      },
    }),
  });

  const stream = await youtubeFetch<{
    id: string;
    cdn?: { ingestionInfo?: { ingestionAddress?: string; streamName?: string } };
    status?: { streamStatus?: string };
  }>(`/liveStreams?part=snippet,cdn,status`, auth, {
    method: "POST",
    body: JSON.stringify({
      snippet: { title: `${title} — ingest` },
      cdn: {
        frameRate: "variable",
        ingestionType: "rtmp",
        resolution: "variable",
      },
    }),
  });

  const bound = await youtubeFetch<{
    id: string;
    status?: { lifeCycleStatus?: string };
  }>(
    `/liveBroadcasts/bind?id=${broadcast.id}&streamId=${stream.id}&part=id,status`,
    auth,
    { method: "POST" },
  );

  const ingestion = stream.cdn?.ingestionInfo;
  const rtmpUrl = ingestion?.ingestionAddress ?? "";
  const streamKey = ingestion?.streamName ?? "";

  return {
    broadcastId: bound.id,
    streamId: stream.id,
    videoId: broadcast.id,
    title,
    lifeCycleStatus: bound.status?.lifeCycleStatus ?? "created",
    streamStatus: stream.status?.streamStatus ?? "inactive",
    rtmpUrl,
    streamKey,
  };
}

export async function transitionBroadcastToLive(
  auth: YouTubeAuthConfig,
  broadcastId: string,
): Promise<{ lifeCycleStatus: string }> {
  const result = await youtubeFetch<{ status?: { lifeCycleStatus?: string } }>(
    `/liveBroadcasts/transition?broadcastStatus=live&id=${broadcastId}&part=status`,
    auth,
    { method: "POST" },
  );

  return {
    lifeCycleStatus: result.status?.lifeCycleStatus ?? "live",
  };
}

export async function getLiveBroadcastStatus(
  auth: YouTubeAuthConfig,
  broadcastId: string,
): Promise<LiveBroadcastInfo | null> {
  const data = await youtubeFetch<{
    items?: Array<{
      id: string;
      snippet?: { title?: string };
      status?: { lifeCycleStatus?: string };
    }>;
  }>(`/liveBroadcasts?part=snippet,status&id=${broadcastId}`, auth);

  const item = data.items?.[0];
  if (!item) return null;

  const boundStream = await youtubeFetch<{
    items?: Array<{
      id: string;
      contentDetails?: { boundStreamId?: string };
    }>;
  }>(`/liveBroadcasts?part=contentDetails&id=${broadcastId}`, auth);

  const streamId = boundStream.items?.[0]?.contentDetails?.boundStreamId;
  let rtmpUrl = "";
  let streamKey = "";
  let streamStatus = "inactive";

  if (streamId) {
    const streamData = await youtubeFetch<{
      items?: Array<{
        cdn?: { ingestionInfo?: { ingestionAddress?: string; streamName?: string } };
        status?: { streamStatus?: string };
      }>;
    }>(`/liveStreams?part=cdn,status&id=${streamId}`, auth);

    const stream = streamData.items?.[0];
    rtmpUrl = stream?.cdn?.ingestionInfo?.ingestionAddress ?? "";
    streamKey = stream?.cdn?.ingestionInfo?.streamName ?? "";
    streamStatus = stream?.status?.streamStatus ?? "inactive";
  }

  return {
    broadcastId: item.id,
    streamId: streamId ?? "",
    videoId: item.id,
    title: item.snippet?.title ?? "",
    lifeCycleStatus: item.status?.lifeCycleStatus ?? "unknown",
    streamStatus,
    rtmpUrl,
    streamKey,
  };
}

export async function listActiveBroadcasts(
  auth: YouTubeAuthConfig,
): Promise<Array<{ id: string; title: string; lifeCycleStatus: string }>> {
  const data = await youtubeFetch<{
    items?: Array<{
      id: string;
      snippet?: { title?: string };
      status?: { lifeCycleStatus?: string };
    }>;
  }>(
    `/liveBroadcasts?part=snippet,status&broadcastStatus=active&mine=true&maxResults=10`,
    auth,
  );

  return (
    data.items?.map((item) => ({
      id: item.id,
      title: item.snippet?.title ?? "",
      lifeCycleStatus: item.status?.lifeCycleStatus ?? "unknown",
    })) ?? []
  );
}
