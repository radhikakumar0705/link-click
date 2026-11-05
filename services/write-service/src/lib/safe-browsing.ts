/**
 * Google Safe Browsing API v4 client
 *
 * Called by the shorten service before inserting any URL.
 * If the API is unavailable or not configured (no API key), we fail open
 * and log a warning — better to shorten an unchecked URL than to break
 * the entire shorten flow due to a third-party outage.
 *
 * Threat types checked: MALWARE, SOCIAL_ENGINEERING (phishing), UNWANTED_SOFTWARE,
 * POTENTIALLY_HARMFUL_APPLICATION.
 */

const SAFE_BROWSING_ENDPOINT =
  'https://safebrowsing.googleapis.com/v4/threatMatches:find';

export type ThreatType =
  | 'MALWARE'
  | 'SOCIAL_ENGINEERING'
  | 'UNWANTED_SOFTWARE'
  | 'POTENTIALLY_HARMFUL_APPLICATION';

export interface ThreatMatch {
  threatType: ThreatType;
  platformType: string;
  threat: { url: string };
  cacheDuration: string;
}

export interface SafeBrowsingResult {
  isSafe: boolean;
  threats: ThreatMatch[];
}

export class SafeBrowsingClient {
  private readonly apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async check(url: string): Promise<SafeBrowsingResult> {
    if (!this.apiKey) {
      // Not configured — fail open with a warning (logged by caller)
      return { isSafe: true, threats: [] };
    }

    const body = {
      client: { clientId: 'link-click', clientVersion: '1.0.0' },
      threatInfo: {
        threatTypes: [
          'MALWARE',
          'SOCIAL_ENGINEERING',
          'UNWANTED_SOFTWARE',
          'POTENTIALLY_HARMFUL_APPLICATION',
        ],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url }],
      },
    };

    try {
      const response = await fetch(`${SAFE_BROWSING_ENDPOINT}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000), // 3s timeout — never block shorten on this
      });

      if (!response.ok) {
        // API error — fail open
        return { isSafe: true, threats: [] };
      }

      const data = (await response.json()) as { matches?: ThreatMatch[] };

      if (!data.matches || data.matches.length === 0) {
        return { isSafe: true, threats: [] };
      }

      return { isSafe: false, threats: data.matches };
    } catch {
      // Network error / timeout — fail open
      return { isSafe: true, threats: [] };
    }
  }
}

/**
 * Returns a human-readable description of the detected threat type
 * for surfacing in the extension UI and API error responses.
 */
export function describeThreat(threatType: ThreatType): string {
  const descriptions: Record<ThreatType, string> = {
    MALWARE: 'This URL has been flagged as distributing malware.',
    SOCIAL_ENGINEERING: 'This URL has been flagged as a phishing site.',
    UNWANTED_SOFTWARE: 'This URL has been flagged as distributing unwanted software.',
    POTENTIALLY_HARMFUL_APPLICATION: 'This URL has been flagged as potentially harmful.',
  };
  return descriptions[threatType] ?? 'This URL has been flagged as unsafe.';
}
