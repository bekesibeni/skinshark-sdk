import type { HttpClient, RequestOptions } from '../internal/http.js';
import type { UserProfile } from '../types/api.js';

/** Actor-context profile reads. With opts.onBehalfOf set, returns that sub-user's profile. */
export class ProfileModule {
  constructor(private readonly http: HttpClient) {}

  /** Actor identity, Steam link, Discord link, wallet snapshot. */
  get(opts?: RequestOptions): Promise<UserProfile> {
    return this.http.request<UserProfile>('GET', 'user', { opts });
  }
}
