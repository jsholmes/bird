import { parse as devalueParse } from 'devalue';

export interface SweetisticsClientOptions {
  baseUrl: string;
  apiKey: string;
  userAgent?: string;
}

export interface SweetisticsTweetResult {
  success: boolean;
  tweetId?: string;
  error?: string;
}

export interface SweetisticsTweet {
  id: string;
  text: string;
  author: {
    username: string;
    name: string;
  };
  createdAt?: string;
  replyCount?: number;
  retweetCount?: number;
  likeCount?: number;
  conversationId?: string;
  inReplyToStatusId?: string;
}

export interface SweetisticsTimelineResult {
  success: boolean;
  tweets?: SweetisticsTweet[];
  error?: string;
}

export interface SweetisticsReadResult {
  success: boolean;
  tweet?: SweetisticsTweet;
  error?: string;
}

type TrpcResponseEnvelope = { result?: { data?: unknown; error?: unknown } };

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'https://sweetistics.com';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export class SweetisticsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly userAgent?: string;

  constructor(options: SweetisticsClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey.trim();
    this.userAgent = options.userAgent;
    if (!this.apiKey) {
      throw new Error('Sweetistics API key is required');
    }
  }

  async tweet(text: string, replyToTweetId?: string): Promise<SweetisticsTweetResult> {
    const payload: Record<string, unknown> = { text };
    if (replyToTweetId) {
      payload.replyToTweetId = replyToTweetId;
    }

    const response = await fetch(`${this.baseUrl}/api/actions/tweet`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        ...(this.userAgent ? { 'user-agent': this.userAgent } : {}),
      },
      body: JSON.stringify(payload),
    });

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      return {
        success: false,
        error: `Sweetistics response parse failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const success = typeof (data as { success?: unknown })?.success === 'boolean' ? (data as { success: boolean }).success : false;
    const tweetId = typeof (data as { tweetId?: unknown })?.tweetId === 'string' ? (data as { tweetId?: string }).tweetId : undefined;
    const errorMessage = typeof (data as { error?: unknown })?.error === 'string' ? (data as { error?: string }).error : undefined;

    if (!response.ok || !success) {
      const reason = errorMessage || `HTTP ${response.status}`;
      return { success: false, error: reason };
    }

    return { success: true, tweetId };
  }

  async read(tweetId: string): Promise<SweetisticsReadResult> {
    // Public REST route that returns a single tweet record
    const url = `${this.baseUrl}/api/tweets/${encodeURIComponent(tweetId)}`;
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(this.userAgent ? { 'user-agent': this.userAgent } : {}),
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    let data: any;
    try {
      data = await response.json();
    } catch (error) {
      return {
        success: false,
        error: `Sweetistics response parse failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (!data?.id || !data?.author) {
      return { success: false, error: 'Malformed tweet payload from Sweetistics' };
    }

    const tweet: SweetisticsTweet = {
      id: String(data.id),
      text: String(data.text ?? ''),
      author: {
        username: String(data.author.username ?? ''),
        name: String(data.author.name ?? ''),
      },
      createdAt: data.createdAt,
      replyCount: data.metrics?.replyCount,
      retweetCount: data.metrics?.retweetCount,
      likeCount: data.metrics?.likeCount,
      conversationId: data.conversationId,
      inReplyToStatusId: data.referencedTweets?.find?.((r: any) => r?.type === 'replied_to')?.id,
    };

    return { success: true, tweet };
  }

  async replies(tweetId: string): Promise<SweetisticsTimelineResult> {
    return this.fetchConversation(tweetId, { excludeRoot: true });
  }

  async thread(tweetId: string): Promise<SweetisticsTimelineResult> {
    return this.fetchConversation(tweetId, { excludeRoot: false });
  }

  async search(query: string, count: number): Promise<SweetisticsTimelineResult> {
    const payload = {
      query,
      capabilities: [
        {
          resource: 'tweets',
          source: 'postgres',
          limit: Math.max(1, Math.min(count, 50)),
          offset: 0,
          detail: 'summary',
          includeRetweets: true,
        },
      ],
    };

    const response = await fetch(`${this.baseUrl}/api/trpc/search.execute?batch=1`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        ...(this.userAgent ? { 'user-agent': this.userAgent } : {}),
      },
      body: JSON.stringify({ 0: { json: payload } }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    let body: any;
    try {
      body = await response.json();
    } catch (error) {
      return {
        success: false,
        error: `Sweetistics response parse failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const envelope = Array.isArray(body) ? body[0] : body;
    if (envelope?.error) {
      const message = envelope.error?.message ?? 'Unknown search error';
      return { success: false, error: message };
    }
    const dataField = envelope?.result?.data;
    if (!dataField) {
      return { success: false, error: 'Missing data in Sweetistics search response' };
    }

    let parsed: any;
    try {
      parsed = typeof dataField === 'string' ? devalueParse(dataField) : dataField;
    } catch (error) {
      return {
        success: false,
        error: `Sweetistics search decode failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const tweetsSection = parsed?.tweets;
    const items: any[] = tweetsSection?.items ?? [];
    if (items.length === 0) {
      return { success: true, tweets: [] };
    }

    const tweets: SweetisticsTweet[] = items.map((item) => {
      const authorUsername = item.authorUsername || item.username || item.full?.author?.username || '';
      const authorName = item.authorName || item.full?.author?.name || authorUsername;
      const createdAt =
        typeof item.createdAt === 'string'
          ? item.createdAt
          : item.createdAt?.toString?.() ??
            (Array.isArray(item.createdAt) && item.createdAt[0] === 'Date' ? item.createdAt[1] : undefined);
      const metrics = item.full?.metrics ?? item.full ?? item;

      return {
        id: String(item.id),
        text: String(item.text ?? item.full?.text ?? ''),
        author: { username: String(authorUsername), name: String(authorName) },
        createdAt,
        replyCount: metrics?.replyCount ?? metrics?.replies ?? 0,
        retweetCount: metrics?.retweetCount ?? metrics?.retweets ?? 0,
        likeCount: metrics?.likeCount ?? metrics?.likes ?? 0,
        conversationId: item.conversationId ?? item.full?.conversationId,
        inReplyToStatusId: item.full?.inReplyToStatusId ?? undefined,
      };
    });

    return { success: true, tweets };
  }

  private async fetchConversation(
    tweetId: string,
    options: { excludeRoot: boolean },
  ): Promise<SweetisticsTimelineResult> {
    const url = new URL(`${this.baseUrl}/api/trpc/tweets.getConversation`);
    url.searchParams.set('input', JSON.stringify({ tweetId }));

    const response = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(this.userAgent ? { 'user-agent': this.userAgent } : {}),
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    let envelope: TrpcResponseEnvelope;
    try {
      envelope = (await response.json()) as TrpcResponseEnvelope;
    } catch (error) {
      return {
        success: false,
        error: `Sweetistics response parse failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (!envelope?.result?.data) {
      return { success: false, error: 'Missing data in Sweetistics response' };
    }

    let parsed: any;
    try {
      const raw = typeof envelope.result.data === 'string' ? devalueParse(envelope.result.data as string) : envelope.result.data;
      parsed = raw;
    } catch (error) {
      return {
        success: false,
        error: `Sweetistics response decode failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const tweetIds: string[] = Array.isArray(parsed?.tweetIds) ? parsed.tweetIds.map(String) : [];
    const tweetsMap: Record<string, any> = parsed?.tweets ?? {};

    if (tweetIds.length === 0 || Object.keys(tweetsMap).length === 0) {
      return { success: false, error: 'Conversation empty or unavailable' };
    }

    const rootId = tweetId;
    const filteredIds = options.excludeRoot ? tweetIds.filter((id) => id !== rootId) : tweetIds;

    const tweets: SweetisticsTweet[] = filteredIds
      .map((id) => tweetsMap[id])
      .filter(Boolean)
      .map((item: any) => ({
        id: String(item.id),
        text: String(item.text ?? ''),
        author: {
          username: String(item.author?.username ?? ''),
          name: String(item.author?.name ?? ''),
        },
        createdAt: item.createdAt ?? item.timestamp ?? undefined,
        replyCount: item.replyCount ?? item.metrics?.replyCount,
        retweetCount: item.retweetCount ?? item.metrics?.retweetCount,
        likeCount: item.likeCount ?? item.metrics?.likeCount,
        conversationId: item.conversationId ?? undefined,
        inReplyToStatusId: item.inReplyToStatusId ?? undefined,
      }));

    return { success: true, tweets };
  }
}
